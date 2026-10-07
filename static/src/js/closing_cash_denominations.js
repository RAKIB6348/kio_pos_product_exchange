/** @odoo-module */

import { ClosePosPopup } from "@point_of_sale/app/navbar/closing_popup/closing_popup";
import { patch } from "@web/core/utils/patch";

const CASH_DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 2];

patch(ClosePosPopup.prototype, {
    getInitialState() {
        const state = super.getInitialState(...arguments);
        state.cashDenominations = CASH_DENOMINATIONS.map((value) => ({
            value,
            quantity: "",
        }));
        return state;
    },

    setDenominationQuantity(denomination, event) {
        const inputValue = event.target.value;
        if (inputValue === "") {
            denomination.quantity = "";
        } else {
            denomination.quantity = Math.max(0, Math.trunc(Number(inputValue) || 0));
            event.target.value = denomination.quantity;
        }
        this.updateCashCountedFromDenominations();
    },

    getDenominationAmount(denomination) {
        return denomination.value * (Number(denomination.quantity) || 0);
    },

    getTotalNoteQuantity() {
        return this.state.cashDenominations.reduce(
            (total, denomination) => total + (Number(denomination.quantity) || 0),
            0
        );
    },

    getDenominationTotalAmount() {
        return this.state.cashDenominations.reduce(
            (total, denomination) => total + this.getDenominationAmount(denomination),
            0
        );
    },

    updateCashCountedFromDenominations() {
        if (!this.pos.config.show_cash_denominations) {
            return;
        }
        const counted = this.env.utils.formatCurrency(this.getDenominationTotalAmount(), false);
        this.setManualCashInput(counted);
        this.state.payments[this.props.default_cash_details.id].counted = counted;
    },
});
