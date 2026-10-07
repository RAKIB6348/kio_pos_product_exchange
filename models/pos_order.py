# -*- coding: utf-8 -*-

import logging

from odoo import _, api, fields, models
from odoo.exceptions import ValidationError


_logger = logging.getLogger(__name__)

EXCHANGE_ADJUSTMENT_CODE = "POS_EXCHANGE_ADJUSTMENT"
EXCHANGE_ADJUSTMENT_NAME = "Exchange Adjustment Fee"


class PosOrder(models.Model):
    _inherit = "pos.order"

    is_exchange_order = fields.Boolean(string="Exchange Order", readonly=True, index=True)
    source_order_id = fields.Many2one("pos.order", string="Original Order", readonly=True, index=True)
    source_order_line_id = fields.Many2one(
        "pos.order.line", string="Original Order Line", readonly=True, index=True
    )
    exchange_record_id = fields.Many2one(
        "pos.exchange.record", string="Exchange Record", readonly=True, index=True
    )

    @api.model
    def _find_exchange_adjustment_product(self):
        products = (
            self.env["product.product"]
            .sudo()
            .with_context(active_test=False)
            .search(
                [("default_code", "=", EXCHANGE_ADJUSTMENT_CODE)],
                order="company_id, id",
            )
        )
        if len(products) > 1:
            _logger.warning(
                "Multiple products use the internal reference %s; using product id=%s",
                EXCHANGE_ADJUSTMENT_CODE,
                products[0].id,
            )
        return products[:1]

    @api.model
    def _ensure_exchange_adjustment_product(self):
        product = self._find_exchange_adjustment_product()
        if product:
            return product

        creation_values = {
            "name": EXCHANGE_ADJUSTMENT_NAME,
            "default_code": EXCHANGE_ADJUSTMENT_CODE,
            "detailed_type": "service",
            "sale_ok": True,
            "purchase_ok": False,
            "available_in_pos": False,
            "list_price": 0.0,
            "company_id": False,
            "active": True,
            "taxes_id": [(6, 0, [])],
        }
        return (
            self.env["product.template"]
            .sudo()
            .create(creation_values)
            .product_variant_id
        )

    @api.model
    def _get_exchange_adjustment_product(self):
        product = self._find_exchange_adjustment_product()
        if not product:
            raise ValidationError(
                _(
                    "The Exchange Adjustment Fee product is not provisioned. "
                    "Please upgrade the POS Product Exchange module."
                )
            )
        return product

    @api.model
    def get_exchange_adjustment_product(self, session_id):
        session = self.env["pos.session"].browse(session_id).exists()
        if not session:
            raise ValidationError(_("The POS session could not be found."))
        product = self._get_exchange_adjustment_product()
        if product.company_id and product.company_id != session.company_id:
            raise ValidationError(
                _("The Exchange Adjustment Fee product is not available to this POS company.")
            )
        return product.id

    @api.model
    def _order_fields(self, ui_order):
        vals = super()._order_fields(ui_order)
        exchange_data = ui_order.get("exchange_data") or {}
        vals.update(
            {
                "is_exchange_order": bool(exchange_data.get("is_exchange_order")),
                "source_order_id": exchange_data.get("source_order_id") or False,
                "source_order_line_id": exchange_data.get("source_order_line_id") or False,
            }
        )
        return vals

    @api.model
    def _process_order(self, order, draft, existing_order):
        exchange_data = (order.get("data") or {}).get("exchange_data") or {}
        _logger.info(
            "POS exchange payload: draft=%s is_exchange_order=%s source_order_id=%s source_order_line_id=%s old_lines=%s replacement_lines=%s",
            draft,
            exchange_data.get("is_exchange_order"),
            exchange_data.get("source_order_id"),
            exchange_data.get("source_order_line_id"),
            len(exchange_data.get("old_lines", []) or exchange_data.get("lines", [])),
            len(exchange_data.get("replacement_lines", [])),
        )
        order_id = super()._process_order(order, draft, existing_order)
        if not draft and exchange_data.get("is_exchange_order") and order_id:
            exchange_order = self.browse(order_id)
            self._validate_exchange_value(exchange_data, exchange_order)
            _logger.info("Creating exchange record for POS order id=%s", order_id)
            exchange_order._create_exchange_record(exchange_data)
        return order_id

    @api.model
    def _validate_exchange_value(self, exchange_data, exchange_order):
        if exchange_data.get("exchange_type") != "new_product":
            return

        currency = exchange_order.currency_id or self.env.company.currency_id
        adjustment_product = self._get_exchange_adjustment_product()
        invalid_adjustment_lines = exchange_order.lines.filtered(
            lambda line: line.is_exchange_adjustment
            and line.product_id != adjustment_product
        )
        if invalid_adjustment_lines:
            raise ValidationError(_("The exchange adjustment uses an invalid product."))

        adjustment_lines = exchange_order.lines.filtered(
            lambda line: line.product_id == adjustment_product
        )
        if any(not line.is_exchange_adjustment for line in adjustment_lines):
            raise ValidationError(_("The Exchange Adjustment Fee line is not marked correctly."))

        return_lines = exchange_order.lines.filtered(
            lambda line: line.qty < 0 and line.product_id != adjustment_product
        )
        replacement_lines = exchange_order.lines.filtered(
            lambda line: line.qty > 0 and line.product_id != adjustment_product
        )
        old_total = currency.round(sum(abs(line.price_subtotal_incl) for line in return_lines))
        replacement_total = currency.round(
            sum(line.price_subtotal_incl for line in replacement_lines)
        )
        required_adjustment = currency.round(max(old_total - replacement_total, 0))
        adjustment_total = currency.round(
            sum(line.price_subtotal_incl for line in adjustment_lines)
        )

        if currency.compare_amounts(adjustment_total, required_adjustment) != 0:
            raise ValidationError(
                _(
                    "The exchange adjustment amount must be %(required)s; the submitted "
                    "adjustment amount is %(submitted)s."
                )
                % {
                    "required": f"{required_adjustment:.{currency.decimal_places}f}",
                    "submitted": f"{adjustment_total:.{currency.decimal_places}f}",
                }
            )

        if required_adjustment and adjustment_lines:
            return_tax_sets = {
                frozenset(line.tax_ids_after_fiscal_position.ids) for line in return_lines
            }
            invalid_tax_lines = adjustment_lines.filtered(
                lambda line: frozenset(line.tax_ids_after_fiscal_position.ids)
                not in return_tax_sets
            )
            if invalid_tax_lines:
                raise ValidationError(
                    _(
                        "The Exchange Adjustment Fee must use an applicable tax "
                        "structure from the returned merchandise."
                    )
                )

        if required_adjustment:
            exchange_tax_total = currency.round(
                sum(
                    line.price_subtotal_incl - line.price_subtotal
                    for line in return_lines | replacement_lines | adjustment_lines
                )
            )
            if currency.compare_amounts(exchange_tax_total, 0) != 0:
                raise ValidationError(
                    _(
                        "The exchange taxes must balance to zero; the submitted net tax "
                        "amount is %(amount)s."
                    )
                    % {
                        "amount": f"{exchange_tax_total:.{currency.decimal_places}f}",
                    }
                )

    def _create_exchange_record(self, exchange_data):
        self.ensure_one()
        if not self.is_exchange_order or self.exchange_record_id:
            return self.exchange_record_id

        existing_record = self.env["pos.exchange.record"].search(
            [("exchange_order_id", "=", self.id)], limit=1
        )
        if existing_record:
            if not self.exchange_record_id:
                self.write({"exchange_record_id": existing_record.id})
            return existing_record

        source_order = self.env["pos.order"].browse(exchange_data.get("source_order_id")).exists()
        source_line = self.env["pos.order.line"].browse(
            exchange_data.get("source_order_line_id")
        ).exists()
        if not source_order or not source_line or source_line.order_id != source_order:
            _logger.warning(
                "Skipping exchange record for POS order id=%s: invalid source order/line (%s/%s)",
                self.id,
                exchange_data.get("source_order_id"),
                exchange_data.get("source_order_line_id"),
            )
            return False

        old_line_items = exchange_data.get("old_lines") or exchange_data.get("lines") or []
        old_line_values = []
        for data in old_line_items:
            old_line_values.append(
                (
                    0,
                    0,
                    {
                        "original_order_line_id": data.get("original_order_line_id") or source_line.id,
                        "old_product_id": data.get("old_product_id") or False,
                        "old_qty": data.get("old_qty", 0),
                        "old_unit_price": data.get("old_unit_price", 0),
                        "old_total": data.get("old_total", 0),
                        "replacement_product_id": data.get("replacement_product_id") or False,
                        "replacement_qty": data.get("replacement_qty", 0),
                        "replacement_unit_price": data.get("replacement_unit_price", 0),
                        "replacement_total": data.get("replacement_total", 0),
                        "difference_amount": data.get("difference_amount", 0),
                    },
                )
            )

        currency = self.currency_id or self.env.company.currency_id
        adjustment_product = self._get_exchange_adjustment_product()
        actual_return_lines = self.lines.filtered(
            lambda line: line.qty < 0 and line.product_id != adjustment_product
        )
        actual_replacement_lines = self.lines.filtered(
            lambda line: line.qty > 0 and line.product_id != adjustment_product
        )
        actual_adjustment_lines = self.lines.filtered(
            lambda line: line.product_id == adjustment_product
        )
        old_total = currency.round(
            sum(abs(line.price_subtotal_incl) for line in actual_return_lines)
        )
        replacement_total = currency.round(
            sum(line.price_subtotal_incl for line in actual_replacement_lines)
        )
        adjustment_total = currency.round(
            sum(line.price_subtotal_incl for line in actual_adjustment_lines)
        )
        customer_payable = currency.round(max(replacement_total - old_total, 0))

        replacement_line_values = []
        for line in actual_replacement_lines:
            replacement_line_values.append(
                (
                    0,
                    0,
                    {
                        "replacement_product_id": line.product_id.id,
                        "replacement_qty": line.qty,
                        "replacement_unit_price": line.price_unit,
                        "replacement_total": line.price_subtotal_incl,
                    },
                )
            )

        if not old_line_values and not replacement_line_values:
            return False

        vals = {
            "source_order_id": source_order.id,
            "exchange_order_id": self.id,
            "customer_id": self.partner_id.id or False,
            "session_id": self.session_id.id,
            "config_id": self.config_id.id,
            "cashier_id": self.user_id.id or False,
            "exchange_date": self.date_order,
            "old_total": old_total,
            "replacement_total": replacement_total,
            "adjustment_total": adjustment_total,
            "customer_payable": customer_payable,
            "difference_amount": currency.round(replacement_total - old_total),
            "state": "completed",
            "line_ids": old_line_values,
        }

        if "replacement_line_ids" in self.env["pos.exchange.record"]._fields:
            vals["replacement_line_ids"] = replacement_line_values

        record = self.env["pos.exchange.record"].create(vals)
        self.write({"exchange_record_id": record.id})
        return record


class PosOrderLine(models.Model):
    _inherit = "pos.order.line"

    is_exchange_adjustment = fields.Boolean(
        string="Exchange Adjustment", readonly=True, index=True
    )
