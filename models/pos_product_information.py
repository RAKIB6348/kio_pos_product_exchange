# -*- coding: utf-8 -*-

from odoo import _, api, fields, models
from odoo.exceptions import AccessError, UserError
from odoo.osv import expression


BRANCH_INVENTORY_USER_GROUP = "kio_branch_inventory.group_branch_inventory_user"
PRODUCT_SEARCH_LIMIT = 30
# Context key honoured by kio_branch_inventory's stock.quant override to skip
# the assigned-location UI domain.  Used solely for the read-only aggregate
# below, which is already restricted to authorised warehouses; nothing else
# in this method runs in that environment.
BRANCH_QUANT_DOMAIN_BYPASS = "branch_inventory_quant_domain_applied"


class PosSession(models.Model):
    _inherit = "pos.session"

    def _check_cross_branch_session(self, session_id):
        """Validate the branch group and the POS session, then return the session."""
        if not self.env.user.has_group(BRANCH_INVENTORY_USER_GROUP):
            raise AccessError(_("You are not allowed to search cross-branch product information."))

        session = self.browse(session_id).exists()
        if not session:
            raise UserError(_("The POS session could not be found."))
        session.check_access_rights("read")
        session.check_access_rule("read")

        allowed_companies = self.env.companies
        if session.company_id not in allowed_companies:
            raise AccessError(_("You are not allowed to access this POS session."))
        return session

    def _get_cross_branch_warehouses(self, company_ids):
        """Warehouses in the allowed companies.

        Deliberately not sudo: warehouse record rules remain authoritative for
        which branches the caller may see.
        """
        return self.env["stock.warehouse"].search([
            ("company_id", "in", company_ids),
            ("lot_stock_id", "!=", False),
        ], order="company_id, name")

    def _get_pos_source_location(self):
        self = self[:1]
        if not self:
            return self.env["stock.location"]
        picking_type = self.config_id.picking_type_id
        return (
            picking_type.default_location_src_id
            or (picking_type.warehouse_id.lot_stock_id if picking_type else False)
        )

    @api.model
    def search_cross_branch_product_information(self, session_id, search_term):
        """Return read-only product and warehouse stock information for POS.

        Products and warehouses are searched in the caller's normal security
        context.  The quant read is elevated only to bypass quant ACLs and the
        branch assigned-location UI domain; its domain is limited to the
        warehouses already authorised above, and only aggregate quantities
        leave the server.  Any lookup failure raises instead of returning
        zero quantities.
        """
        session = self._check_cross_branch_session(session_id)
        allowed_companies = self.env.companies

        search_term = (search_term or "").strip()
        if not search_term:
            return []

        company_ids = allowed_companies.ids
        products = self._search_pos_products(search_term, company_ids)

        if not products:
            return []

        warehouses = self._get_cross_branch_warehouses(company_ids)
        stock_by_warehouse = self._get_cross_branch_stock(products, warehouses)

        return [
            self._prepare_cross_branch_product_information(
                product, warehouses, stock_by_warehouse, session.company_id
            )
            for product in products
        ]

    @api.model
    def _search_pos_products(self, search_term, company_ids, extra_domain=None, pos_only=False):
        product_domain = expression.AND([
            [("active", "=", True),
             ("company_id", "in", [False] + company_ids)] + (
                [("available_in_pos", "=", True), ("sale_ok", "=", True)] if pos_only else []
            ),
            expression.OR([
                [("name", "ilike", search_term)],
                [("barcode", "ilike", search_term)],
                [("default_code", "ilike", search_term)],
            ]),
            extra_domain or [],
        ])
        return self.env["product.product"].search(
            product_domain, limit=PRODUCT_SEARCH_LIMIT, order="name, default_code, id"
        )

    @api.model
    def get_cross_branch_pos_products(self, session_id, search_term):
        """Products matching ``search_term`` that are sellable in the POS but
        have no positive (On Hand - Reserved) stock in the current branch, yet
        do have positive free stock in at least one authorised branch of the
        allowed companies.

        Returned in the standard POS product wire format so the frontend can
        add them to its local database.  This never affects what may be
        *sold*: it only makes the products searchable, and sale restrictions
        for the current branch remain fully enforced.
        """
        session = self._check_cross_branch_session(session_id)
        allowed_companies = self.env.companies

        search_term = (search_term or "").strip()
        if len(search_term) < 2:
            return []

        company_ids = allowed_companies.ids
        products = self._search_pos_products(search_term, company_ids, pos_only=True)
        if not products:
            return []

        warehouses = self._get_cross_branch_warehouses(company_ids)
        stock_by_warehouse = self._get_cross_branch_stock(products, warehouses)

        def free_qty(product, warehouse):
            return stock_by_warehouse.get((warehouse.id, product.id), 0.0)

        eligible = [
            product for product in products
            if any(free_qty(product, warehouse) > 0.0 for warehouse in warehouses)
        ]
        if not eligible:
            return []

        eligible_ids = [product.id for product in eligible]
        # Local stock at the POS source location, used by the frontend to keep
        # current-branch sale restrictions intact for these products.
        local_qty = session._get_local_free_quantities(eligible_ids, session)
        availability_text = self._get_availability_text(eligible, warehouses, stock_by_warehouse)

        # Core POS product loader fields (odoo 17.0), plus the stock fields
        # appended by the installed branch modules. Built directly instead of
        # via ``_loader_params_product_product`` so we do not rebuild the whole
        # (expensive) POS available-product domain on every search keystroke.
        fields = [
            'display_name', 'lst_price', 'standard_price', 'categ_id', 'pos_categ_ids',
            'taxes_id', 'barcode', 'default_code', 'to_weight', 'uom_id',
            'description_sale', 'description', 'product_tmpl_id', 'tracking',
            'write_date', 'available_in_pos', 'attribute_line_ids', 'active',
            'image_128', 'combo_ids', 'product_tag_ids', 'name', 'type',
            'qty_available', 'virtual_available',
        ]
        for extra in ("kio_discount_percent",):
            if hasattr(session.env["product.product"], extra) and extra not in fields:
                fields.append(extra)
        product_data = self.env["product.product"].with_context(
            active_test=False, display_default_code=False
        ).browse(eligible_ids).read(fields)
        self._process_cross_branch_products(session, product_data)
        for data in product_data:
            data["kio_cross_branch_local_qty"] = local_qty.get(data["id"], 0.0)
            data["kio_cross_branch_availability"] = availability_text.get(data["id"], "")
        return product_data

    def _process_cross_branch_products(self, session, products):
        """Replicates the core ``_process_pos_ui_product_product`` (v17) on the
        fetched dictionaries.

        The branch stock modules inject ``pos_stock_managed``/``kio_pos_stock_qty``
        there, which would hide these zero-local-stock products from the POS grid
        entirely. These products must stay visible in search results while remaining
        unsellable in this branch, so only the core currency/category processing is
        applied here; current-branch sale enforcement for them is done on the
        frontend via the ``kio_cross_branch_local_qty`` marker.
        """
        config = session.config_id
        if config.currency_id != session.company_id.currency_id:
            for product in products:
                product["lst_price"] = session.company_id.currency_id._convert(
                    product["lst_price"], config.currency_id,
                    session.company_id, fields.Date.today(),
                )
        categories = session._get_pos_ui_product_category(session._loader_params_product_category())
        category_by_id = {category["id"]: category for category in categories}
        for product in products:
            product["categ"] = category_by_id.get(product["categ_id"][0]) if product.get("categ_id") else False
            product["image_128"] = bool(product.get("image_128"))

    def _get_local_free_quantities(self, product_ids, session):
        """Free (On Hand - Reserved) quantities at this POS's source location."""
        location = session._get_pos_source_location()
        if not location:
            return {}
        Quant = self.env["stock.quant"].sudo()
        if hasattr(Quant, "_with_branch_inventory_domain_applied"):
            Quant = Quant._with_branch_inventory_domain_applied()
        else:
            Quant = Quant.with_context(**{BRANCH_QUANT_DOMAIN_BYPASS: True})
        grouped = Quant.read_group(
            [
                ("product_id", "in", product_ids),
                ("company_id", "=", session.company_id.id),
                ("location_id", "child_of", location.id),
                ("location_id.usage", "=", "internal"),
            ],
            ["product_id", "quantity:sum", "reserved_quantity:sum"],
            ["product_id"],
            lazy=False,
        )
        return {
            row["product_id"][0]: row.get("quantity", 0.0) - row.get("reserved_quantity", 0.0)
            for row in grouped
            if row["product_id"]
        }

    def _get_availability_text(self, products, warehouses, stock_by_warehouse):
        """Human-readable list of branches with positive free stock."""
        availability = {}
        for product in products:
            parts = [
                "%s: %g" % (warehouse.display_name, stock_by_warehouse[(warehouse.id, product.id)])
                for warehouse in warehouses
                if stock_by_warehouse.get((warehouse.id, product.id), 0.0) > 0.0
            ]
            availability[product.id] = ", ".join(parts)
        return availability

    @api.model
    def get_product_branch_stock_information(self, session_id, product_id):
        """Read-only, single-product branch stock information for the product card."""
        session = self._check_cross_branch_session(session_id)
        allowed_companies = self.env.companies

        product = self.env["product.product"].browse(product_id).exists()
        if not product:
            raise UserError(_("The product could not be found."))
        product.check_access_rights("read")
        product.check_access_rule("read")
        allowed_companies = self.env.companies
        if product.company_id and product.company_id not in allowed_companies:
            raise AccessError(_("You are not allowed to access this product."))

        company_ids = allowed_companies.ids
        warehouses = self._get_cross_branch_warehouses(company_ids)
        stock_by_warehouse = self._get_cross_branch_stock(product, warehouses)
        return self._prepare_cross_branch_product_information(
            product, warehouses, stock_by_warehouse, session.company_id
        )

    @api.model
    def _get_cross_branch_stock(self, products, warehouses):
        """Aggregate free quantity once per warehouse/product pair.

        A warehouse is queried from its single stock root using ``child_of``.
        Quants are grouped rather than summing location balances, preventing
        parent/child locations from being counted twice.
        """
        quantities = {}
        Quant = self.env["stock.quant"].sudo()
        # The Branch Inventory stock.quant override applies its assigned-location
        # domain based on env.user, so plain sudo() is not enough to read
        # quantities for other branches.  Skip that UI domain for this single
        # read-only, warehouse-scoped aggregate only.  Record rules are not
        # touched and no other query uses this environment.
        if hasattr(Quant, "_with_branch_inventory_domain_applied"):
            Quant = Quant._with_branch_inventory_domain_applied()
        else:
            Quant = Quant.with_context(**{BRANCH_QUANT_DOMAIN_BYPASS: True})
        for warehouse in warehouses:
            grouped_quants = Quant.read_group(
                [
                    ("product_id", "in", products.ids),
                    ("company_id", "=", warehouse.company_id.id),
                    ("location_id", "child_of", warehouse.lot_stock_id.id),
                    ("location_id.usage", "=", "internal"),
                ],
                ["product_id", "quantity:sum", "reserved_quantity:sum"],
                ["product_id"],
                lazy=False,
            )
            for row in grouped_quants:
                if row["product_id"]:
                    quantities[(warehouse.id, row["product_id"][0])] = (
                        row.get("quantity", 0.0) - row.get("reserved_quantity", 0.0)
                    )
        return quantities

    @api.model
    def _get_variant_attribute_value(self, product, attribute_name):
        values = product.product_template_attribute_value_ids.filtered(
            lambda value: (value.attribute_id.name or "").strip().casefold()
            == attribute_name.casefold()
        )
        return ", ".join(values.mapped("name"))

    @api.model
    def _prepare_cross_branch_product_information(
        self, product, warehouses, stock_by_warehouse, sales_company
    ):
        sales_product = product.with_company(sales_company)
        return {
            "id": product.id,
            "name": product.display_name,
            "barcode": product.barcode or "",
            "default_code": product.default_code or "",
            "sales_price": sales_product.lst_price,
            "size": self._get_variant_attribute_value(product, "Size"),
            "color": self._get_variant_attribute_value(product, "Color"),
            "stock_by_warehouse": [
                {
                    "warehouse_id": warehouse.id,
                    "warehouse_name": warehouse.display_name,
                    "available_qty": stock_by_warehouse.get((warehouse.id, product.id), 0.0),
                }
                for warehouse in warehouses
            ],
        }
