# -*- coding: utf-8 -*-

from odoo import api, fields, models, _


class PosCashDenomination(models.Model):
    _name = "pos.cash.denomination"
    _description = "POS Cash Denomination"
    _order = "closing_date desc, id desc"

    name = fields.Char(
        string="Reference",
        required=True,
        readonly=True,
        copy=False,
        default="New",
        index=True,
    )
    pos_session_id = fields.Many2one(
        "pos.session", string="POS Session", readonly=True, required=True, index=True
    )
    pos_config_id = fields.Many2one(
        "pos.config", string="Point of Sale", readonly=True, index=True
    )
    user_id = fields.Many2one(
        "res.users", string="Closing User", readonly=True, required=True
    )
    closing_date = fields.Datetime(
        string="Closing Date", readonly=True, required=True
    )
    total_notes = fields.Integer(
        string="Total Notes", readonly=True, index=True
    )
    total_amount = fields.Monetary(
        string="Total Amount", readonly=True, currency_field="currency_id"
    )
    currency_id = fields.Many2one(
        "res.currency", string="Currency", related="pos_session_id.currency_id", store=True, readonly=True
    )
    line_ids = fields.One2many(
        "pos.cash.denomination.line", "header_id", string="Denomination Lines", readonly=True
    )

    _sql_constraints = [
        ("pos_session_unique", "unique(pos_session_id)", "A cash denomination record already exists for this POS session."),
    ]

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get("name", "New") == "New":
                vals["name"] = self.env["ir.sequence"].next_by_code("pos.cash.denomination") or "New"
        return super().create(vals_list)


class PosCashDenominationLine(models.Model):
    _name = "pos.cash.denomination.line"
    _description = "POS Cash Denomination Line"
    _order = "id"

    denomination = fields.Selection(
        [
            ("1000", "1000 BDT"),
            ("500", "500 BDT"),
            ("200", "200 BDT"),
            ("100", "100 BDT"),
            ("50", "50 BDT"),
            ("20", "20 BDT"),
            ("10", "10 BDT"),
            ("5", "5 BDT"),
            ("2", "2 BDT"),
        ],
        string="Denomination",
        required=True,
    )
    note_qty = fields.Integer(
        string="Note Qty", readonly=False, default=0
    )
    amount = fields.Monetary(
        string="Amount", readonly=True, currency_field="currency_id"
    )
    header_id = fields.Many2one(
        "pos.cash.denomination", string="Header", required=True, ondelete="cascade", index=True
    )
    currency_id = fields.Many2one(
        "res.currency", related="header_id.currency_id", store=True, readonly=True
    )

    @api.onchange("denomination", "note_qty")
    def _onchange_compute_amount(self):
        if self.denomination and self.note_qty:
            rates = {
                "1000": 1000,
                "500": 500,
                "200": 200,
                "100": 100,
                "50": 50,
                "20": 20,
                "10": 10,
                "5": 5,
                "2": 2,
            }
            rate = rates.get(self.denomination, 0)
            self.amount = rate * self.note_qty