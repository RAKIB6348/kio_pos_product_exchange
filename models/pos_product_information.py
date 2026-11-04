# -*- coding: utf-8 -*-

from odoo import _, api, models
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

        search_term = (search_term or "").strip()
        if not search_term:
            return []

        company_ids = allowed_companies.ids
        product_domain = expression.AND([
            [("active", "=", True), ("company_id", "in", [False] + company_ids)],
            expression.OR([
                [("name", "ilike", search_term)],
                [("barcode", "ilike", search_term)],
                [("default_code", "ilike", search_term)],
            ]),
        ])
        products = self.env["product.product"].search(
            product_domain, limit=PRODUCT_SEARCH_LIMIT, order="name, default_code, id"
        )
        if not products:
            return []

        # Do not sudo this search: warehouse record rules remain authoritative.
        warehouses = self.env["stock.warehouse"].search([
            ("company_id", "in", company_ids),
            ("lot_stock_id", "!=", False),
        ], order="company_id, name")
        stock_by_warehouse = self._get_cross_branch_stock(products, warehouses)

        return [
            self._prepare_cross_branch_product_information(
                product, warehouses, stock_by_warehouse, session.company_id
            )
            for product in products
        ]

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
