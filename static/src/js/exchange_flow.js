/** @odoo-module */

import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/store/pos_store";

patch(PosStore.prototype, {
    clearExchangeState() {
        this.exchangeState = null;
    },

    getExchangePayableAmount(order) {
        const orderTotal = this.env.utils.roundCurrency(order?.get_total_with_tax() || 0);
        return Math.max(orderTotal, 0);
    },

    isExchangePaymentRequired(order) {
        return this.getExchangePayableAmount(order) > 0;
    },

    setExchangeReplacement(exchangeState, replacementLine) {
        const originalExchangeTotal = Number(exchangeState.oldTotal) || 0;
        const replacementTotal = replacementLine.get_price_with_tax();
        const rawDifference = replacementTotal - originalExchangeTotal;
        const customerPayable = Math.max(rawDifference, 0);
        const customerRefund = 0;
        const noRefundExchange = rawDifference <= 0;

        // Keep the signed product-line total visible. A lower-value replacement is
        // non-refundable, but that policy must not rewrite either product's price
        // or replace the raw order total with the customer payable amount.
        replacementLine.order.autoValidateExchange = false;

        this.exchangeState = Object.assign({}, exchangeState, {
            replacementProduct: replacementLine.product,
            replacementOrderline: replacementLine,
            replacementOrderlines: [replacementLine],
            originalExchangeTotal,
            replacementTotal,
            rawDifference,
            customerPayable,
            customerRefund,
            // Retained for the existing exchange export/record flow.
            payableDifference: customerPayable,
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
