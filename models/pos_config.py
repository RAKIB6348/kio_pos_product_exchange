# -*- coding: utf-8 -*-

from odoo import fields, models


class PosConfig(models.Model):
    _inherit = "pos.config"

    show_cash_denominations = fields.Boolean(
        string="Show Cash Denominations on Closing",
        default=False,
    )