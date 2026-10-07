/** @odoo-module */

import { patch } from "@web/core/utils/patch";
import { Order, Orderline } from "@point_of_sale/app/store/models";
import { ConfirmPopup } from "@point_of_sale/app/utils/confirm_popup/confirm_popup";
import { _t } from "@web/core/l10n/translation";

patch(Order.prototype, {
    async pay() {
        if (
            this.exchangeState?.exchangeType === "new_product" &&
            !(await this.pos.validateExchangeBeforePayment(this))
        ) {
            return;
        }
        const exchangeTotals = this.pos.getExchangeTotals?.(this);
        if (
            this.exchangeState?.exchangeType === "new_product" &&
            exchangeTotals?.isExchangeComplete &&
            this.pos.env.utils.roundCurrency(exchangeTotals.customerPayable) === 0
        ) {
            if (!this.canPay()) {
                return;
            }
            if (
                this.orderlines.some(
                    (line) =>
                        line.get_product().tracking !== "none" && !line.has_valid_product_lot()
                ) &&
                (this.pos.picking_type.use_create_lots || this.pos.picking_type.use_existing_lots)
            ) {
                const { confirmed } = await this.pos.env.services.popup.add(ConfirmPopup, {
                    title: _t("Some Serial/Lot Numbers are missing"),
                    body: _t(
                        "You are trying to sell products with serial/lot numbers, but some of them are not set.\nWould you like to proceed anyway?"
                    ),
                    confirmText: _t("Yes"),
                    cancelText: _t("No"),
                });
                if (!confirmed) {
                    return;
                }
            }
            this.autoValidateExchange = true;
            this.pos.showScreen("PaymentScreen");
            return;
        }
        return super.pay(...arguments);
    },

    async add_product(product, options) {
        const line = await super.add_product(product, options);
        if (line && options?.is_exchange_adjustment) {
            line.is_exchange_adjustment = true;
            line.is_exchange_replacement = false;
        }
        if (
            (this.is_exchange_order || this.pos?.exchangeState?.exchangeOrder === this) &&
            line &&
            !line.is_exchange_adjustment &&
            !line.is_exchange_return &&
            line.get_quantity() > 0
        ) {
            line.is_exchange_replacement = true;
            this.pos.updateExchangeState(this);
            await this.pos.requestExchangeAdjustmentSync(this);
        }
        return line;
    },

    removeOrderline(line) {
        const wasExchangeLine = Boolean(
            this.is_exchange_order || this.pos?.exchangeState?.exchangeOrder === this
        );
        const res = super.removeOrderline(...arguments);
        if (wasExchangeLine) {
            this.pos.updateExchangeState(this);
            if (!this.syncingExchangeAdjustment) {
                this.pos.requestExchangeAdjustmentSync(this);
            }
        }
        return res;
    },

    export_as_JSON() {
        const json = super.export_as_JSON(...arguments);
        const state =
            this.exchangeState ||
            (this.pos?.exchangeState?.exchangeOrder === this ? this.pos.exchangeState : null);
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
        const allLines = this.get_orderlines();
        const returnLines = exchangeItems.map((item) => item.returnLine);
        const adjustmentLines = allLines.filter((line) =>
            this.pos?.isExchangeAdjustmentLine?.(line)
        );
        const replacementLines =
            state?.exchangeType === "same_product"
                ? exchangeItems.map((item) => item.replacementOrderline).filter(Boolean)
                : allLines.filter(
                      (line) =>
                          !returnLines.includes(line) &&
                          !this.pos?.isExchangeAdjustmentLine?.(line) &&
                          (line.is_exchange_replacement || line.get_quantity() > 0)
                  );

        if (
            !state ||
            state.exchangeOrder !== this ||
            !sourceOrder?.backendId ||
            !sourceLine?.id ||
            !exchangeItems.length ||
            exchangeItems.some((item) => !item.sourceOrderline?.id || !item.returnLine) ||
            !replacementLines.length
        ) {
            return json;
        }

        const oldTotal = this.pos.getExchangeTotals(this)?.returnedTotal ??
            exchangeItems.reduce(
                (total, item) => total + Math.abs(item.returnLine.get_price_with_tax()),
                0
            );

        const replacementTotal = this.pos.getExchangeTotals(this)?.replacementTotal ??
            (state.exchangeType === "same_product"
                ? oldTotal
                : replacementLines.reduce(
                      (total, line) => total + line.get_price_with_tax(),
                      0
                  ));

        const rawDifference = replacementTotal - oldTotal;
        const payableDifference =
            this.pos.getExchangeTotals(this)?.customerPayable ??
            (state.exchangeType === "same_product" ? 0 : Math.max(0, rawDifference));
        const adjustmentTotal =
            this.pos.getExchangeTotals(this)?.adjustmentTotal ??
            adjustmentLines.reduce((total, line) => total + line.get_price_with_tax(), 0);

        const oldLines = exchangeItems.map((item) => ({
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
            old_total: Math.abs(item.returnLine.get_price_with_tax()),
        }));

        const replacementLinesData = replacementLines.map((line) => ({
            replacement_product_id: line.product.id,
            replacement_qty: line.get_quantity(),
            replacement_unit_price: line.get_unit_price(),
            replacement_total: line.get_price_with_tax(),
        }));

        const adjustmentLinesData = adjustmentLines.map((line) => ({
            adjustment_product_id: line.product.id,
            adjustment_qty: line.get_quantity(),
            adjustment_unit_price: line.get_unit_price(),
            adjustment_total: line.get_price_with_tax(),
        }));

        const legacyLines = oldLines.map((item, index) => {
            const itemReplacement =
                state.exchangeType === "same_product"
                    ? replacementLinesData[index] || null
                    : null;
            return {
                original_order_line_id: item.original_order_line_id,
                old_product_id: item.old_product_id,
                old_qty: item.old_qty,
                old_unit_price: item.old_unit_price,
                old_total: item.old_total,
                replacement_product_id: itemReplacement?.replacement_product_id || false,
                replacement_qty: itemReplacement?.replacement_qty || 0,
                replacement_unit_price: itemReplacement?.replacement_unit_price || 0,
                replacement_total: itemReplacement?.replacement_total || 0,
                difference_amount: index === 0 ? payableDifference : 0,
            };
        });

        json.exchange_data = {
            is_exchange_order: true,
            exchange_type: state.exchangeType,
            source_order_id: sourceOrder.backendId,
            source_order_name: sourceOrder.name,
            source_order_line_id: sourceLine.id,
            old_total: oldTotal,
            replacement_total: replacementTotal,
            adjustment_total: adjustmentTotal,
            forfeited_amount: adjustmentTotal,
            customer_payable: payableDifference,
            difference_amount: rawDifference,
            old_lines: oldLines,
            replacement_lines: replacementLinesData,
            adjustment_lines: adjustmentLinesData,
            lines: legacyLines,
            customer_name:
                (typeof this.get_partner_name === "function" ? this.get_partner_name() : "") ||
                this.get_partner()?.name ||
                state?.partner?.name ||
                "",
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
        const allLines = this.get_orderlines();
        const adjustmentLines = allLines.filter((line) =>
            this.pos?.isExchangeAdjustmentLine?.(line)
        );
        const returnLines = allLines.filter(
            (line) =>
                !this.pos?.isExchangeAdjustmentLine?.(line) &&
                (line.is_exchange_return || line.get_quantity() < 0)
        );
        const replacementLines = allLines.filter(
            (line) =>
                !this.pos?.isExchangeAdjustmentLine?.(line) &&
                (line.is_exchange_replacement ||
                    (!line.is_exchange_return && line.get_quantity() > 0))
        );

        const isExchange = Boolean(
            this.is_exchange_order ||
            exchangeData?.is_exchange_order ||
            (state && state.exchangeOrder === this && replacementLines.length > 0)
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

        result.returned_lines = returnLines.map((line) => ({
            ...line.getDisplayData(),
            is_exchange_return: true,
        }));

        result.replacement_lines = replacementLines.map((line) => ({
            ...line.getDisplayData(),
            is_replacement: true,
        }));
        result.adjustment_lines = adjustmentLines.map((line) => ({
            ...line.getDisplayData(),
            is_adjustment: true,
        }));

        const exchangeTotals = this.pos?.getExchangeTotals?.(this);
        const oldTotal =
            exchangeTotals?.returnedTotal ??
            exchangeData?.old_total ??
            state?.originalExchangeTotal ??
            returnLines.reduce((sum, line) => sum + Math.abs(line.get_price_with_tax()), 0);

        const replacementTotal =
            exchangeTotals?.replacementTotal ??
            (state?.exchangeType === "same_product"
                ? oldTotal
                : exchangeData?.replacement_total ??
                  state?.replacementTotal ??
                  replacementLines.reduce((sum, line) => sum + line.get_price_with_tax(), 0));

        const rawDifference = replacementTotal - oldTotal;
        const payableDifference =
            exchangeTotals?.customerPayable ??
            (state?.exchangeType === "same_product"
                ? 0
                : exchangeData?.customer_payable ??
                  state?.payableDifference ??
                  (this.pos?.getExchangePayableAmount
                      ? this.pos.getExchangePayableAmount(this)
                      : Math.max(0, rawDifference)));

        result.exchange_type =
            state?.exchangeType || (rawDifference === 0 ? "same_product" : "new_product");
        result.exchange_old_total = oldTotal;
        result.exchange_replacement_total = replacementTotal;
        result.exchange_adjustment_total =
            exchangeTotals?.adjustmentTotal ??
            exchangeData?.adjustment_total ??
            adjustmentLines.reduce((sum, line) => sum + line.get_price_with_tax(), 0);
        result.exchange_raw_difference = rawDifference;
        result.exchange_payable_amount = payableDifference;
        result.is_lower_value_exchange =
            rawDifference < 0 && state?.exchangeType !== "same_product";

        return result;
    },
});

patch(Orderline.prototype, {
    export_as_JSON() {
        const json = super.export_as_JSON(...arguments);
        json.is_exchange_adjustment = Boolean(this.is_exchange_adjustment);
        return json;
    },
    init_from_JSON(json) {
        super.init_from_JSON(...arguments);
        this.is_exchange_adjustment = Boolean(json.is_exchange_adjustment);
    },
    set_quantity(quantity, keep_price) {
        const res = super.set_quantity(...arguments);
        if (
            this.order &&
            this.order.get_orderlines().includes(this) &&
            (this.order.is_exchange_order ||
                this.order.pos?.exchangeState?.exchangeOrder === this.order)
        ) {
            this.order.pos?.updateExchangeState?.(this.order);
            if (!this.order.syncingExchangeAdjustment) {
                this.order.pos?.requestExchangeAdjustmentSync?.(this.order);
            }
        }
        return res;
    },
    set_unit_price(price) {
        const res = super.set_unit_price(...arguments);
        if (
            this.order &&
            this.order.get_orderlines().includes(this) &&
            (this.order.is_exchange_order ||
                this.order.pos?.exchangeState?.exchangeOrder === this.order)
        ) {
            this.order.pos?.updateExchangeState?.(this.order);
            if (!this.order.syncingExchangeAdjustment) {
                this.order.pos?.requestExchangeAdjustmentSync?.(this.order);
            }
        }
        return res;
    },
    set_discount(discount) {
        const res = super.set_discount(...arguments);
        if (
            this.order &&
            this.order.get_orderlines().includes(this) &&
            (this.order.is_exchange_order ||
                this.order.pos?.exchangeState?.exchangeOrder === this.order)
        ) {
            this.order.pos?.updateExchangeState?.(this.order);
            if (!this.order.syncingExchangeAdjustment) {
                this.order.pos?.requestExchangeAdjustmentSync?.(this.order);
            }
        }
        return res;
    },
});
