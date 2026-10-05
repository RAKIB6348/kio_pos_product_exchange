/** @odoo-module */

import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/store/pos_store";
import { ErrorPopup } from "@point_of_sale/app/errors/popups/error_popup";
import { _t } from "@web/core/l10n/translation";

patch(PosStore.prototype, {
    clearExchangeState() {
        this.exchangeState = null;
    },

    getExchangePayableAmount(order) {
        const exchangeTotals = this.getExchangeTotals(order);
        if (exchangeTotals) {
            return exchangeTotals.customerPayable;
        }
        const orderTotal = this.env.utils.roundCurrency(order?.get_total_with_tax() || 0);
        return Math.max(orderTotal, 0);
    },

    isExchangePaymentRequired(order) {
        return this.getExchangePayableAmount(order) > 0;
    },

    getExchangeTotals(order) {
        const targetOrder = order || this.get_order();
        const state = targetOrder?.exchangeState || this.exchangeState;
        if (!targetOrder || !state || state.exchangeOrder && state.exchangeOrder !== targetOrder) {
            return null;
        }

        const round = (value) => this.env.utils.roundCurrency(value || 0);
        const returnLines = targetOrder.get_orderlines().filter(
            (line) => line.is_exchange_return || line.get_quantity() < 0
        );
        const replacementLines = targetOrder.get_orderlines().filter(
            (line) => line.is_exchange_replacement || line.get_quantity() > 0
        );
        const returnedTotal = round(
            returnLines.reduce((total, line) => total + Math.abs(line.get_price_with_tax()), 0)
        );
        const replacementTotal = round(
            state.exchangeType === "same_product"
                ? returnedTotal
                : replacementLines.reduce((total, line) => total + line.get_price_with_tax(), 0)
        );
        const rawDifference = round(replacementTotal - returnedTotal);
        const remainingToAdjust = round(Math.max(returnedTotal - replacementTotal, 0));
        const customerPayable = round(Math.max(replacementTotal - returnedTotal, 0));

        return {
            returnedTotal,
            replacementTotal,
            rawDifference,
            remainingToAdjust,
            customerPayable: state.exchangeType === "same_product" ? 0 : customerPayable,
            isExchangeComplete:
                state.exchangeType === "same_product" || remainingToAdjust === 0,
            returnLines,
            replacementLines,
        };
    },

    validateExchangeBeforePayment(order) {
        const state = order?.exchangeState || this.exchangeState;
        if (!state || state.exchangeType !== "new_product") {
            return true;
        }
        const totals = this.getExchangeTotals(order);
        if (!totals || totals.isExchangeComplete) {
            return true;
        }
        const remaining = this.env.utils.formatCurrency(totals.remainingToAdjust);
        this.env.services.popup.add(ErrorPopup, {
            title: _t("Validation Error"),
            body:
                _t("The replacement product total is still") +
                ` ${remaining} ` +
                _t("below the returned product value.") +
                "\n\n" +
                _t("Please add more products worth at least") +
                ` ${remaining} ` +
                _t("to complete the exchange."),
        });
        return false;
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

        const totals = this.getExchangeTotals(targetOrder);
        const originalExchangeTotal = totals.returnedTotal;
        const replacementTotal = totals.replacementTotal;
        const rawDifference = totals.rawDifference;
        const customerPayable = totals.customerPayable;
        const customerRefund = 0;
        const noRefundExchange =
            state.exchangeType !== "same_product" && totals.remainingToAdjust > 0;

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
            remainingToAdjust: totals.remainingToAdjust,
            isExchangeComplete: totals.isExchangeComplete,
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
