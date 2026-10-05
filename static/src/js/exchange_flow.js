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

    updateExchangeState(order) {
        const targetOrder = order || this.get_order();
        if (!targetOrder) {
            return null;
        }
        const state = targetOrder.exchangeState || this.exchangeState;
        if (!state || (state.exchangeOrder && state.exchangeOrder !== targetOrder)) {
            return null;
        }

        const allLines = targetOrder.get_orderlines();
        const returnLines = allLines.filter(
            (line) => line.is_exchange_return || line.get_quantity() < 0
        );
        const replacementLines = allLines.filter(
            (line) =>
                line.is_exchange_replacement ||
                (!line.is_exchange_return && line.get_quantity() > 0)
        );

        for (const line of replacementLines) {
            line.is_exchange_replacement = true;
        }

        const originalExchangeTotal =
            state.originalExchangeTotal ??
            state.oldTotal ??
            returnLines.reduce((sum, line) => sum + Math.abs(line.get_price_with_tax()), 0);

        const replacementTotal =
            state.exchangeType === "same_product"
                ? originalExchangeTotal
                : replacementLines.reduce((sum, line) => sum + line.get_price_with_tax(), 0);

        const rawDifference = replacementTotal - originalExchangeTotal;
        const customerPayable =
            state.exchangeType === "same_product" ? 0 : Math.max(rawDifference, 0);
        const customerRefund = 0;
        const noRefundExchange = rawDifference <= 0;

        const waitingForReplacement =
            state.exchangeType !== "same_product" && replacementLines.length === 0;

        targetOrder.autoValidateExchange = false;

        const updatedState = Object.assign({}, state, {
            returnLines,
            replacementProduct: replacementLines[0]?.product || null,
            replacementOrderline: replacementLines[0] || null,
            replacementOrderlines: replacementLines,
            originalExchangeTotal,
            replacementTotal,
            rawDifference,
            customerPayable,
            customerRefund,
            payableDifference: customerPayable,
            noRefundExchange,
            waitingForReplacement,
        });

        this.exchangeState = updatedState;
        targetOrder.is_exchange_order = true;
        targetOrder.exchangeState = updatedState;

        return updatedState;
    },

    setExchangeReplacement(exchangeState, replacementLine) {
        if (replacementLine) {
            replacementLine.is_exchange_replacement = true;
        }
        return this.updateExchangeState(replacementLine?.order || this.get_order());
    },

    async addProductToCurrentOrder(product, options = {}) {
        const result = await super.addProductToCurrentOrder(product, options);
        const order = this.get_order();
        if (order && (order.is_exchange_order || this.exchangeState?.exchangeOrder === order)) {
            this.updateExchangeState(order);
        }
        return result;
    },
});
