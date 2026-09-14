# -*- coding: utf-8 -*-

import logging

from odoo import api, fields, models


_logger = logging.getLogger(__name__)


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
            "POS exchange payload: draft=%s is_exchange_order=%s source_order_id=%s source_order_line_id=%s lines=%s",
            draft,
            exchange_data.get("is_exchange_order"),
            exchange_data.get("source_order_id"),
            exchange_data.get("source_order_line_id"),
            len(exchange_data.get("lines", [])),
        )
        order_id = super()._process_order(order, draft, existing_order)
        if not draft and exchange_data.get("is_exchange_order") and order_id:
            _logger.info("Creating exchange record for POS order id=%s", order_id)
            self.browse(order_id)._create_exchange_record(exchange_data)
        return order_id

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

        line_values = []
        for data in exchange_data.get("lines", []):
            line_values.append(
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
        if not line_values:
            return False

        record = self.env["pos.exchange.record"].create(
            {
                "source_order_id": source_order.id,
                "exchange_order_id": self.id,
                "customer_id": self.partner_id.id or False,
                "session_id": self.session_id.id,
                "config_id": self.config_id.id,
                "cashier_id": self.user_id.id or False,
                "exchange_date": self.date_order,
                "old_total": exchange_data.get("old_total", 0),
                "replacement_total": exchange_data.get("replacement_total", 0),
                "difference_amount": exchange_data.get("difference_amount", 0),
                "state": "completed",
                "line_ids": line_values,
            }
        )
        self.write({"exchange_record_id": record.id})
        return record
