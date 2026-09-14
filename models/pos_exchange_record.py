# -*- coding: utf-8 -*-

from odoo import api, fields, models


class PosExchangeRecord(models.Model):
    _name = "pos.exchange.record"
    _description = "POS Exchange Record"
    _order = "exchange_date desc, id desc"

    name = fields.Char(
        string="Exchange Reference",
        required=True,
        readonly=True,
        copy=False,
        default="New",
        index=True,
    )
    source_order_id = fields.Many2one(
        "pos.order", string="Original Order", readonly=True, required=True, index=True
    )
    exchange_order_id = fields.Many2one(
        "pos.order",
        string="Exchange Order",
        readonly=True,
        required=True,
        index=True,
        ondelete="cascade",
    )
    customer_id = fields.Many2one("res.partner", string="Customer", readonly=True, index=True)
    session_id = fields.Many2one("pos.session", string="Session", readonly=True, index=True)
    config_id = fields.Many2one("pos.config", string="Point of Sale", readonly=True, index=True)
    cashier_id = fields.Many2one("res.users", string="Cashier", readonly=True, index=True)
    exchange_date = fields.Datetime(string="Exchange Date", readonly=True, required=True, index=True)
    old_total = fields.Monetary(string="Old Product Total", readonly=True, currency_field="currency_id")
    replacement_total = fields.Monetary(
        string="Replacement Total", readonly=True, currency_field="currency_id"
    )
    difference_amount = fields.Monetary(
        string="Difference", readonly=True, currency_field="currency_id"
    )
    currency_id = fields.Many2one(
        "res.currency", string="Currency", related="exchange_order_id.currency_id", store=True, readonly=True
    )
    state = fields.Selection(
        [("completed", "Completed"), ("refunded", "Refunded"), ("cancelled", "Cancelled")],
        string="Status",
        default="completed",
        required=True,
        readonly=True,
        index=True,
    )
    line_ids = fields.One2many(
        "pos.exchange.record.line", "exchange_id", string="Exchange Lines", readonly=True
    )

    _sql_constraints = [
        ("exchange_order_unique", "unique(exchange_order_id)", "An exchange record already exists for this POS order."),
    ]

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get("name", "New") == "New":
                vals["name"] = self.env["ir.sequence"].next_by_code("pos.exchange.record") or "New"
        return super().create(vals_list)


class PosExchangeRecordLine(models.Model):
    _name = "pos.exchange.record.line"
    _description = "POS Exchange Record Line"
    _order = "id"

    exchange_id = fields.Many2one(
        "pos.exchange.record", string="Exchange", required=True, readonly=True, ondelete="cascade", index=True
    )
    original_order_line_id = fields.Many2one(
        "pos.order.line", string="Original Order Line", readonly=True, index=True
    )
    old_product_id = fields.Many2one("product.product", string="Old Product", readonly=True, index=True)
    old_qty = fields.Float(string="Old Quantity", readonly=True)
    old_unit_price = fields.Monetary(string="Old Unit Price", readonly=True, currency_field="currency_id")
    old_total = fields.Monetary(string="Old Total", readonly=True, currency_field="currency_id")
    replacement_product_id = fields.Many2one(
        "product.product", string="Replacement Product", readonly=True, index=True
    )
    replacement_qty = fields.Float(string="Replacement Quantity", readonly=True)
    replacement_unit_price = fields.Monetary(
        string="Replacement Unit Price", readonly=True, currency_field="currency_id"
    )
    replacement_total = fields.Monetary(
        string="Replacement Total", readonly=True, currency_field="currency_id"
    )
    difference_amount = fields.Monetary(
        string="Difference", readonly=True, currency_field="currency_id"
    )
    currency_id = fields.Many2one(
        "res.currency", related="exchange_id.currency_id", store=True, readonly=True
    )
