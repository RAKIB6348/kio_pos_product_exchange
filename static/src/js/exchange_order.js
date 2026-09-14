/** @odoo-module */

import { patch } from "@web/core/utils/patch";
import { Order } from "@point_of_sale/app/store/models";

patch(Order.prototype, {
    async add_product(product, options) {
        const exchangeState = this.pos.exchangeState;
        const line = await super.add_product(product, options);
        if (
            exchangeState?.waitingForReplacement &&
            line &&
            line !== exchangeState.returnLine &&
            line.get_quantity() > 0
        ) {
            this.pos.exchangeState = Object.assign({}, exchangeState, {
                replacementProduct: line.product,
                replacementOrderline: line,
                waitingForReplacement: false,
            });
        }
        return line;
    },

    export_as_JSON() {
        const json = super.export_as_JSON(...arguments);
        const state = this.pos.exchangeState;
        const sourceOrder = state?.sourceOrder;
        const sourceLine = state?.sourceOrderline;
        const returnLine = state?.returnLine;
        const replacementLine =
            state?.replacementOrderline ||
            this.get_orderlines().find(
                (line) =>
                    line !== returnLine &&
                    line.product === state?.replacementProduct &&
                    line.get_quantity() > 0
            );
        if (
            !state ||
            state.exchangeOrder !== this ||
            state.waitingForReplacement ||
            !sourceOrder?.backendId ||
            !sourceLine?.id ||
            !returnLine ||
            !replacementLine
        ) {
            return json;
        }

        const oldTotal = Math.abs(returnLine.get_price_with_tax());
        const replacementTotal = replacementLine.get_price_with_tax();
        json.exchange_data = {
            is_exchange_order: true,
            source_order_id: sourceOrder.backendId,
            source_order_name: sourceOrder.name,
            source_order_line_id: sourceLine.id,
            old_total: oldTotal,
            replacement_total: replacementTotal,
            difference_amount: replacementTotal - oldTotal,
            lines: [
                {
                    original_order_line_id: sourceLine.id,
                    old_product_id: returnLine.product.id,
                    old_qty: Math.abs(returnLine.get_quantity()),
                    old_unit_price: returnLine.get_unit_price(),
                    old_total: oldTotal,
                    replacement_product_id: replacementLine.product.id,
                    replacement_qty: replacementLine.get_quantity(),
                    replacement_unit_price: replacementLine.get_unit_price(),
                    replacement_total: replacementTotal,
                    difference_amount: replacementTotal - oldTotal,
                },
            ],
        };
        return json;
    },
});
