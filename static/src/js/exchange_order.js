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
            this.pos.setExchangeReplacement(exchangeState, line);
        }
        return line;
    },

    export_as_JSON() {
        const json = super.export_as_JSON(...arguments);
        const state = this.pos.exchangeState;
        const sourceOrder = state?.sourceOrder;
        const exchangeItems = state?.exchangeItems?.length
            ? state.exchangeItems
            : state?.sourceOrderline && state?.returnLine
            ? [
                  {
                      sourceOrderline: state.sourceOrderline,
                      returnLine: state.returnLine,
                      replacementOrderline: state.replacementOrderline,
                  },
              ]
            : [];
        const sourceLine = exchangeItems[0]?.sourceOrderline;
        const returnLines = exchangeItems.map((item) => item.returnLine);
        const replacementLine =
            state?.replacementOrderline ||
            this.get_orderlines().find(
                (line) =>
                    !returnLines.includes(line) &&
                    line.product === state?.replacementProduct &&
                    line.get_quantity() > 0
            );
        if (
            !state ||
            state.exchangeOrder !== this ||
            state.waitingForReplacement ||
            !sourceOrder?.backendId ||
            !sourceLine?.id ||
            !exchangeItems.length ||
            exchangeItems.some((item) => !item.sourceOrderline?.id || !item.returnLine) ||
            !replacementLine
        ) {
            return json;
        }

        const oldTotal =
            state.originalExchangeTotal ??
            exchangeItems.reduce(
                (total, item) => total + Math.abs(item.sourceOrderline.get_price_with_tax()),
                0
            );
        const replacementLines =
            state.exchangeType === "same_product"
                ? exchangeItems.map((item) => item.replacementOrderline)
                : [replacementLine];
        if (replacementLines.some((line) => !line)) {
            return json;
        }
        const replacementTotal =
            state.exchangeType === "same_product"
                ? oldTotal
                : state.replacementTotal ??
                  replacementLines.reduce((total, line) => total + line.get_price_with_tax(), 0);
        const payableDifference =
            state.exchangeType === "same_product"
                ? 0
                : state.payableDifference ?? Math.max(0, replacementTotal - oldTotal);
        const lines = exchangeItems.map((item, index) => {
            const itemOldTotal = Math.abs(item.sourceOrderline.get_price_with_tax());
            const itemReplacementLine =
                state.exchangeType === "same_product"
                    ? item.replacementOrderline
                    : index === 0
                    ? replacementLine
                    : null;
            const itemReplacementTotal =
                state.exchangeType === "same_product"
                    ? itemOldTotal
                    : itemReplacementLine
                    ? itemReplacementLine.get_price_with_tax()
                    : 0;
            return {
                original_order_line_id: item.sourceOrderline.id,
                old_product_id:
                    state.exchangeType === "same_product"
                        ? item.sourceOrderline.product.id
                        : item.returnLine.product.id,
                old_qty: Math.abs(
                    state.exchangeType === "same_product"
                        ? item.sourceOrderline.get_quantity()
                        : item.returnLine.get_quantity()
                ),
                old_unit_price:
                    state.exchangeType === "same_product"
                        ? item.sourceOrderline.get_unit_price()
                        : item.returnLine.get_unit_price(),
                old_total: itemOldTotal,
                replacement_product_id: itemReplacementLine?.product.id || false,
                replacement_qty: itemReplacementLine?.get_quantity() || 0,
                replacement_unit_price:
                    state.exchangeType === "same_product"
                        ? item.sourceOrderline.get_unit_price()
                        : itemReplacementLine?.get_unit_price() || 0,
                replacement_total: itemReplacementTotal,
                difference_amount: index === 0 ? payableDifference : 0,
            };
        });
        json.exchange_data = {
            is_exchange_order: true,
            source_order_id: sourceOrder.backendId,
            source_order_name: sourceOrder.name,
            source_order_line_id: sourceLine.id,
            old_total: oldTotal,
            replacement_total: replacementTotal,
            difference_amount: payableDifference,
            lines,
        };
        return json;
    },
});
