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
            line.is_exchange_replacement = true;
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
                (total, item) => total + Math.abs(item.returnLine.get_price_with_tax()),
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
            const itemOldTotal = Math.abs(item.returnLine.get_price_with_tax());
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
                old_qty: Math.abs(item.returnLine.get_quantity()),
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
            customer_name: (typeof this.get_partner_name === "function" ? this.get_partner_name() : "") || this.get_partner()?.name || state?.partner?.name || "",
        };
        this.exchange_data = json.exchange_data;
        this.is_exchange_order = true;
        this.source_order_name = sourceOrder.name;
        this.customer_name = json.exchange_data.customer_name;
        return json;
    },

    init_from_JSON(json) {
        super.init_from_JSON(...arguments);
        if (json.exchange_data) {
            this.exchange_data = json.exchange_data;
            this.is_exchange_order = Boolean(json.exchange_data.is_exchange_order);
            this.source_order_name = json.exchange_data.source_order_name;
            this.customer_name = json.exchange_data.customer_name;
        }
    },

    export_for_printing() {
        const result = super.export_for_printing(...arguments);
        const state =
            this.exchangeState ||
            (this.pos?.exchangeState?.exchangeOrder === this ? this.pos.exchangeState : null);
        const exchangeData = this.exchange_data;
        const isExchange = Boolean(
            this.is_exchange_order ||
            exchangeData?.is_exchange_order ||
            (state && state.exchangeOrder === this && !state.waitingForReplacement)
        );

        if (!isExchange) {
            result.is_exchange_order = false;
            return result;
        }

        result.is_exchange_order = true;
        const rawSourceOrderName =
            this.source_order_name ||
            state?.sourceOrderName ||
            state?.sourceOrder?.name ||
            exchangeData?.source_order_name ||
            "";

        result.source_order_name = rawSourceOrderName;
        result.source_order_ref = rawSourceOrderName.replace(/^Order\s+/, "");
        result.exchange_ref = this.exchange_record_name || this.exchange_ref || "";
        const partner = this.get_partner() || state?.partner;
        const customerName =
            (typeof this.get_partner_name === "function" ? this.get_partner_name() : "") ||
            partner?.name ||
            exchangeData?.customer_name ||
            this.customer_name ||
            "";
        result.customer_name = customerName;
        result.partner_name = customerName;

        const allLines = this.get_orderlines();
        const returnLines = allLines.filter(
            (line) => line.is_exchange_return || line.get_quantity() < 0
        );
        const replacementLines = allLines.filter(
            (line) =>
                line.is_exchange_replacement ||
                (!line.is_exchange_return && line.get_quantity() > 0)
        );

        result.returned_lines = returnLines.map((line) => ({
            ...line.getDisplayData(),
            is_exchange_return: true,
        }));

        result.replacement_lines = replacementLines.map((line) => ({
            ...line.getDisplayData(),
            is_replacement: true,
        }));

        const oldTotal =
            exchangeData?.old_total ??
            state?.originalExchangeTotal ??
            returnLines.reduce((sum, line) => sum + Math.abs(line.get_price_with_tax()), 0);

        const replacementTotal =
            state?.exchangeType === "same_product"
                ? oldTotal
                : exchangeData?.replacement_total ??
                  state?.replacementTotal ??
                  replacementLines.reduce((sum, line) => sum + line.get_price_with_tax(), 0);

        const rawDifference = replacementTotal - oldTotal;
        const payableDifference =
            state?.exchangeType === "same_product"
                ? 0
                : exchangeData?.difference_amount ??
                  state?.payableDifference ??
                  (this.pos?.getExchangePayableAmount
                      ? this.pos.getExchangePayableAmount(this)
                      : Math.max(0, rawDifference));

        result.exchange_type =
            state?.exchangeType || (rawDifference === 0 ? "same_product" : "new_product");
        result.exchange_old_total = oldTotal;
        result.exchange_replacement_total = replacementTotal;
        result.exchange_raw_difference = rawDifference;
        result.exchange_payable_amount = payableDifference;
        result.is_lower_value_exchange =
            rawDifference < 0 && state?.exchangeType !== "same_product";

        return result;
    },
});
