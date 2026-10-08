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

        const totalAmount = this.getDenominationTotalAmount();

        // ১. ওডুর ডিফল্ট মেথডে ফ্লোট ভ্যালু পাঠানো
        if (typeof this.setManualCashInput === "function") {
            this.setManualCashInput(totalAmount);
        }

        // ২. ক্র্যাশ এড়াতে সেফটি চেক (optional chaining) দিয়ে স্টেট আপডেট
        const cashId = this.props.default_cash_details?.id;
        if (cashId && this.state.payments && this.state.payments[cashId]) {
            this.state.payments[cashId].counted = totalAmount;
        }
    },
});
