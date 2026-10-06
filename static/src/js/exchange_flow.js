/** @odoo-module */

import { patch } from "@web/core/utils/patch";
import { PosStore } from "@point_of_sale/app/store/pos_store";

const EXCHANGE_ADJUSTMENT_CODE = "POS_EXCHANGE_ADJUSTMENT";

patch(PosStore.prototype, {
    clearExchangeState() {
        this.exchangeState = null;
    },

    isExchangeAdjustmentLine(line) {
        return Boolean(
            line?.is_exchange_adjustment ||
                line?.product?.default_code === EXCHANGE_ADJUSTMENT_CODE
        );
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
        if (!targetOrder || !state || (state.exchangeOrder && state.exchangeOrder !== targetOrder)) {
            return null;
        }

        const round = (value) => this.env.utils.roundCurrency(value || 0);
        const allLines = targetOrder.get_orderlines();
        const adjustmentLines = allLines.filter((line) => this.isExchangeAdjustmentLine(line));
        const returnLines = allLines.filter(
            (line) =>
                !this.isExchangeAdjustmentLine(line) &&
                (line.is_exchange_return || line.get_quantity() < 0)
        );
        const replacementLines = allLines.filter(
            (line) =>
                !this.isExchangeAdjustmentLine(line) &&
                (line.is_exchange_replacement || line.get_quantity() > 0)
        );
        const returnedTotal = round(
            returnLines.reduce((total, line) => total + Math.abs(line.get_price_with_tax()), 0)
        );
        const replacementTotal = round(
            state.exchangeType === "same_product"
                ? returnedTotal
                : replacementLines.reduce((total, line) => total + line.get_price_with_tax(), 0)
        );
        const adjustmentTotal = round(
            adjustmentLines.reduce((total, line) => total + line.get_price_with_tax(), 0)
        );
        const merchandiseTax = round(
            [...returnLines, ...replacementLines].reduce(
                (total, line) => total + line.get_tax(),
                0
            )
        );
        const adjustmentTax = round(
            adjustmentLines.reduce((total, line) => total + line.get_tax(), 0)
        );
        const rawDifference = round(replacementTotal - returnedTotal);
        const remainingToAdjust = round(Math.max(returnedTotal - replacementTotal, 0));
        const customerPayable = round(Math.max(replacementTotal - returnedTotal, 0));
        const adjustmentDifference = round(adjustmentTotal - remainingToAdjust);
        const taxDifference = round(merchandiseTax + adjustmentTax);

        return {
            returnedTotal,
            replacementTotal,
            adjustmentTotal,
            merchandiseTax,
            adjustmentTax,
            taxDifference,
            rawDifference,
            remainingToAdjust,
            customerPayable: state.exchangeType === "same_product" ? 0 : customerPayable,
            adjustmentDifference,
            isExchangeComplete:
                state.exchangeType === "same_product" ||
                (adjustmentDifference === 0 &&
                    (remainingToAdjust <= 0 || taxDifference === 0)),
            returnLines,
            replacementLines,
            adjustmentLines,
        };
    },

    async getExchangeAdjustmentProduct() {
        if (this.exchangeAdjustmentProduct) {
            return this.exchangeAdjustmentProduct;
        }
        if (!this.exchangeAdjustmentProductPromise) {
            this.exchangeAdjustmentProductPromise = (async () => {
                const productId = await this.orm.call(
                    "pos.order",
                    "get_exchange_adjustment_product",
                    [this.pos_session.id]
                );
                return this.getProductById(productId);
            })();
        }
        try {
            this.exchangeAdjustmentProduct = await this.exchangeAdjustmentProductPromise;
            return this.exchangeAdjustmentProduct;
        } finally {
            this.exchangeAdjustmentProductPromise = null;
        }
    },

    isLiveExchangeOrder(order) {
        const state = order?.exchangeState || this.exchangeState;
        return Boolean(
            order &&
                state &&
                state.exchangeType === "new_product" &&
                (!state.exchangeOrder || state.exchangeOrder === order)
        );
    },

    getExchangeAdjustmentPricing(order, totals) {
        const grossAmount = totals.remainingToAdjust;
        const round = (value) => this.env.utils.roundCurrency(value || 0);
        const targetTax = round(-totals.merchandiseTax);
        const taxCandidates = [];
        const seenTaxSets = new Set();

        for (const returnLine of totals.returnLines) {
            const taxIds = returnLine.get_taxes().map((tax) => tax.id);
            const signature = [...taxIds].sort((left, right) => left - right).join(",");
            if (!seenTaxSets.has(signature)) {
                seenTaxSets.add(signature);
                taxCandidates.push(taxIds);
            }
        }
        if (!taxCandidates.length) {
            taxCandidates.push([]);
        }

        let bestPricing = null;

        for (const taxIds of taxCandidates) {
            const mappedTaxes = this.get_taxes_after_fp(taxIds, order.fiscal_position);
            let unitPrice = grossAmount;
            for (let iteration = 0; iteration < 12 && mappedTaxes.length; iteration++) {
                const computedGross = this.compute_all(
                    mappedTaxes,
                    unitPrice,
                    1,
                    this.currency.rounding
                ).total_included;
                const difference = grossAmount - computedGross;
                if (round(difference) === 0) {
                    break;
                }
                const probeSize = this.currency.rounding || 0.01;
                const probedGross = this.compute_all(
                    mappedTaxes,
                    unitPrice + probeSize,
                    1,
                    this.currency.rounding
                ).total_included;
                const slope = (probedGross - computedGross) / probeSize;
                if (!slope) {
                    break;
                }
                unitPrice += difference / slope;
            }
            const priceDigits = this.dp["Product Price"] ?? 2;
            const priceFactor = 10 ** priceDigits;
            unitPrice = Math.round(unitPrice * priceFactor) / priceFactor;
            const computed = this.compute_all(
                mappedTaxes,
                unitPrice,
                1,
                this.currency.rounding
            );
            const pricing = {
                taxIds,
                unitPrice,
                taxDifference: Math.abs(round(computed.taxes.reduce(
                    (total, tax) => total + tax.amount,
                    0
                )) - targetTax),
                grossDifference: Math.abs(round(computed.total_included) - grossAmount),
            };
            if (
                !bestPricing ||
                pricing.taxDifference < bestPricing.taxDifference ||
                (pricing.taxDifference === bestPricing.taxDifference &&
                    pricing.grossDifference < bestPricing.grossDifference)
            ) {
                bestPricing = pricing;
            }
        }

        return bestPricing;
    },

    requestExchangeAdjustmentSync(order) {
        const targetOrder = order || this.get_order();
        if (!this.isLiveExchangeOrder(targetOrder)) {
            return Promise.resolve(null);
        }

        targetOrder.exchangeAdjustmentSyncPending = true;
        if (targetOrder.syncingExchangeAdjustment) {
            return targetOrder.exchangeAdjustmentSyncPromise || Promise.resolve(null);
        }
        if (!targetOrder.exchangeAdjustmentSyncPromise) {
            targetOrder.exchangeAdjustmentSyncPromise = (async () => {
                try {
                    while (targetOrder.exchangeAdjustmentSyncPending) {
                        targetOrder.exchangeAdjustmentSyncPending = false;
                        await this.syncExchangeAdjustment(targetOrder);
                    }
                } finally {
                    targetOrder.exchangeAdjustmentSyncPromise = null;
                }
            })();
        }
        return targetOrder.exchangeAdjustmentSyncPromise;
    },

    async syncExchangeAdjustment(order) {
        const targetOrder = order || this.get_order();
        if (!this.isLiveExchangeOrder(targetOrder) || targetOrder.syncingExchangeAdjustment) {
            return null;
        }

        targetOrder.syncingExchangeAdjustment = true;
        try {
            const totals = this.getExchangeTotals(targetOrder);
            if (!totals) {
                return null;
            }

            const [adjustmentLine, ...duplicateLines] = totals.adjustmentLines;
            for (const duplicateLine of duplicateLines) {
                targetOrder.removeOrderline(duplicateLine);
            }

            if (totals.remainingToAdjust <= 0) {
                if (adjustmentLine) {
                    targetOrder.removeOrderline(adjustmentLine);
                }
                return null;
            }

            const pricing = this.getExchangeAdjustmentPricing(targetOrder, totals);
            let line = adjustmentLine;
            if (!line) {
                const product = await this.getExchangeAdjustmentProduct();
                line = await targetOrder.add_product(product, {
                    quantity: 1,
                    price: pricing.unitPrice,
                    discount: 0,
                    tax_ids: pricing.taxIds,
                    merge: false,
                    is_exchange_adjustment: true,
                });
            }

            line.is_exchange_adjustment = true;
            line.is_exchange_replacement = false;
            line.tax_ids = pricing.taxIds;
            if (line.get_quantity() !== 1) {
                line.set_quantity(1, "do not recompute unit price");
            }
            if (line.get_discount() !== 0) {
                line.set_discount(0);
            }
            if (
                this.env.utils.roundCurrency(line.get_price_with_tax()) !==
                totals.remainingToAdjust
            ) {
                line.set_unit_price(pricing.unitPrice);
            }
            this.updateExchangeState(targetOrder);
            return line;
        } finally {
            targetOrder.syncingExchangeAdjustment = false;
        }
    },

    async validateExchangeBeforePayment(order) {
        const state = order?.exchangeState || this.exchangeState;
        if (!state || state.exchangeType !== "new_product") {
            return true;
        }

        await this.requestExchangeAdjustmentSync(order);
        return Boolean(this.getExchangeTotals(order)?.isExchangeComplete);
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
        const adjustmentLines = allLines.filter((line) => this.isExchangeAdjustmentLine(line));
        const returnLines = allLines.filter(
            (line) =>
                !this.isExchangeAdjustmentLine(line) &&
                (line.is_exchange_return || line.get_quantity() < 0)
        );
        const replacementLines = allLines.filter(
            (line) =>
                !this.isExchangeAdjustmentLine(line) &&
                (line.is_exchange_replacement ||
                    (!line.is_exchange_return && line.get_quantity() > 0))
        );

        for (const line of replacementLines) {
            line.is_exchange_replacement = true;
        }
        for (const line of adjustmentLines) {
            line.is_exchange_adjustment = true;
            line.is_exchange_replacement = false;
        }

        const totals = this.getExchangeTotals(targetOrder);
        const waitingForReplacement =
            state.exchangeType !== "same_product" && replacementLines.length === 0;

        targetOrder.autoValidateExchange = false;

        const updatedState = Object.assign({}, state, {
            returnLines,
            replacementProduct: replacementLines[0]?.product || null,
            replacementOrderline: replacementLines[0] || null,
            replacementOrderlines: replacementLines,
            adjustmentOrderline: adjustmentLines[0] || null,
            adjustmentOrderlines: adjustmentLines,
            originalExchangeTotal: totals.returnedTotal,
            replacementTotal: totals.replacementTotal,
            adjustmentTotal: totals.adjustmentTotal,
            rawDifference: totals.rawDifference,
            customerPayable: totals.customerPayable,
            customerRefund: 0,
            payableDifference: totals.customerPayable,
            noRefundExchange: totals.remainingToAdjust > 0,
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
