/** @odoo-module */

import { AbstractAwaitablePopup } from "@point_of_sale/app/popup/abstract_awaitable_popup";
import { usePos } from "@point_of_sale/app/store/pos_hook";
import { useState } from "@odoo/owl";
import { _t } from "@web/core/l10n/translation";

export class ExchangeDetailsPopup extends AbstractAwaitablePopup {
    static template = "kio_pos_product_exchange.ExchangeDetailsPopup";
    static defaultProps = {
        confirmText: _t("Select Replacement Product"),
        confirmSelectionText: _t("Confirm"),
        cancelText: _t("Cancel"),
        title: _t("Order Details"),
        cancelKey: "Escape",
        confirmKey: "Enter",
    };

    setup() {
        super.setup();
        this.pos = usePos();
        this.state = useState({ selectedLineId: null, confirmed: false });
    }

    get orderlines() {
        return this.props.order.get_orderlines();
    }

    canSelectLine(line) {
        return this.props.canExchangeLine ? this.props.canExchangeLine(line) : true;
    }

    isLineSelected(line) {
        return this.state.selectedLineId === line.id;
    }

    get selectedLine() {
        return this.orderlines.find((line) => line.id === this.state.selectedLineId) || null;
    }

    onLineClick(line) {
        if (!this.canSelectLine(line)) {
            return;
        }
        this.state.selectedLineId = this.state.selectedLineId === line.id ? null : line.id;
        this.state.confirmed = false;
    }

    onSelectReplacement() {
        if (this.selectedLine) {
            this.confirm();
        }
    }

    onConfirmSelection() {
        if (this.selectedLine) {
            this.state.confirmed = true;
        }
    }

    async getPayload() {
        return this.selectedLine
            ? { order: this.props.order, orderline: this.selectedLine }
            : null;
    }
}