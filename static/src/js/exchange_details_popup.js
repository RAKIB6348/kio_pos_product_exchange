/** @odoo-module */

import { AbstractAwaitablePopup } from "@point_of_sale/app/popup/abstract_awaitable_popup";
import { usePos } from "@point_of_sale/app/store/pos_hook";
import { useState } from "@odoo/owl";
import { _t } from "@web/core/l10n/translation";

export class ExchangeDetailsPopup extends AbstractAwaitablePopup {
    static template = "kio_pos_product_exchange.ExchangeDetailsPopup";
    static defaultProps = {
        validateText: _t("Validate"),
        continueText: _t("Continue"),
        cancelText: _t("Cancel"),
        title: _t("Order Details"),
        cancelKey: "Escape",
        confirmKey: "Enter",
    };

    setup() {
        super.setup();
        this.pos = usePos();
        this.state = useState({
            selectedLineIds: [],
            confirmed: false,
            exchangeChoice: null,
        });
    }

    get orderlines() {
        return this.props.order.get_orderlines();
    }

    canSelectLine(line) {
        return Boolean(
            this.state.exchangeChoice &&
                (this.props.canExchangeLine ? this.props.canExchangeLine(line) : true)
        );
    }

    isLineSelected(line) {
        return this.state.selectedLineIds.includes(line.id);
    }

    get selectedLines() {
        return this.orderlines.filter((line) => this.state.selectedLineIds.includes(line.id));
    }

    onLineClick(line) {
        if (!this.canSelectLine(line)) {
            return;
        }
        this.state.selectedLineIds = this.isLineSelected(line)
            ? this.state.selectedLineIds.filter((lineId) => lineId !== line.id)
            : [...this.state.selectedLineIds, line.id];
        this.state.confirmed = false;
    }

    selectExchangeChoice(choice) {
        this.state.exchangeChoice = choice;
    }

    canContinue() {
        return Boolean(this.selectedLines.length && this.state.exchangeChoice);
    }

    getTotalExchangeValue() {
        return this.selectedLines.reduce(
            (total, line) => total + Math.abs(line.get_price_with_tax()),
            0
        );
    }

    getFormattedTotalExchangeValue() {
        return this.env.utils.formatCurrency(this.getTotalExchangeValue());
    }

    async confirm() {
        if (this.canContinue()) {
            return super.confirm();
        }
    }

    async getPayload() {
        return this.selectedLines.length
            ? {
                  order: this.props.order,
                  orderline: this.selectedLines[0],
                  orderlines: this.selectedLines,
                  exchangeChoice: this.state.exchangeChoice,
                  totalExchangeValue: this.getTotalExchangeValue(),
              }
            : null;
    }
}
