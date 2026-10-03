/** @odoo-module */

import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/store/pos_store";

patch(PosStore.prototype, {
    clearExchangeState() {
        this.exchangeState = null;
    },

    setExchangeReplacement(exchangeState, replacementLine) {
        const originalExchangeTotal = Number(exchangeState.oldTotal) || 0;
        const replacementTotal = replacementLine.get_price_with_tax();
        const rawDifference = replacementTotal - originalExchangeTotal;
        const noRefundExchange = rawDifference <= 0;

        if (noRefundExchange) {
            const returnLines = exchangeState.returnLines || [exchangeState.returnLine];
            const currentReturnTotal = returnLines.reduce(
                (total, line) => total + Math.abs(line.get_price_with_tax()),
                0
            );
            const creditRatio = currentReturnTotal ? replacementTotal / currentReturnTotal : 0;
            for (const returnLine of returnLines) {
                returnLine.set_unit_price(returnLine.get_unit_price() * creditRatio);
            }
            for (let index = 0; index < 12; index++) {
                const orderTotal = replacementLine.order.get_total_with_tax();
                if (this.env.utils.floatIsZero(orderTotal)) {
                    break;
                }
                const returnLine = returnLines[returnLines.length - 1];
                const currentLineTotal = Math.abs(returnLine.get_price_with_tax());
                if (!currentLineTotal) {
                    break;
                }
                const targetLineTotal = Math.max(0, currentLineTotal + orderTotal);
                const currentUnitPrice = returnLine.get_unit_price();
                const targetUnitPrice = currentUnitPrice * (targetLineTotal / currentLineTotal);
                returnLine.set_unit_price(targetUnitPrice);
                if (returnLine.get_unit_price() === currentUnitPrice) {
                    break;
                }
            }
            replacementLine.order.autoValidateExchange = true;
        }

        this.exchangeState = Object.assign({}, exchangeState, {
            replacementProduct: replacementLine.product,
            replacementOrderline: replacementLine,
            replacementOrderlines: [replacementLine],
            originalExchangeTotal,
            replacementTotal,
            rawDifference,
            payableDifference: Math.max(0, rawDifference),
            noRefundExchange,
            waitingForReplacement: false,
        });
        return this.exchangeState;
    },

    async addProductToCurrentOrder(product, options = {}) {
        const exchangeState = this.exchangeState;
        const order = this.get_order();
        const replacementProduct = Number.isInteger(product)
            ? this.db.get_product_by_id(product)
            : product;
        const existingLineIds = new Set(order?.get_orderlines().map((line) => line.id) || []);
        const result = await super.addProductToCurrentOrder(product, options);
        if (exchangeState?.waitingForReplacement && this.exchangeState?.waitingForReplacement) {
            const currentOrder = this.get_order();
            const replacementLine = currentOrder?.get_selected_orderline()?.product === replacementProduct
                ? currentOrder.get_selected_orderline()
                : currentOrder?.get_orderlines().find(
                      (line) =>
                          line.product === replacementProduct &&
                          !existingLineIds.has(line.id) &&
                          line !== exchangeState.returnLine
                  );
            if (replacementLine) {
                this.setExchangeReplacement(exchangeState, replacementLine);
            }
        }
        return result;
    },
});
