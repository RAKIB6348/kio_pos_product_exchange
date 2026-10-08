/** @odoo-module */

import { ClosePosPopup } from "@point_of_sale/app/navbar/closing_popup/closing_popup";
import { ErrorPopup } from "@point_of_sale/app/errors/popups/error_popup";
import { patch } from "@web/core/utils/patch";
import { _t } from "@web/core/l10n/translation";
import { serializeDateTime } from "@web/core/l10n/dates";

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
            this.state.payments[cashId].counted = this.env.utils.formatCurrency(totalAmount, false);
        }
    },

    async saveCashDenominationData() {
        if (!this.pos.config.show_cash_denominations) {
            return;
        }

        const denominations = this.state.cashDenominations.filter(
            (d) => (d.quantity || 0) > 0
        );

        if (!denominations.length) {
            return;
        }

        const totalNotes = denominations.reduce(
            (total, d) => total + (Number(d.quantity) || 0),
            0
        );
        const totalAmount = this.getDenominationTotalAmount();

        const sessionId = this.pos.pos_session.id;
        const userId = this.env.services.user.userId;

        const lineIds = denominations.map((d) => {
            return [0, 0, {
                denomination: String(d.value),
                note_qty: Number(d.quantity) || 0,
                amount: this.getDenominationAmount(d),
            }];
        });

        await this.orm.create("pos.cash.denomination", [{
            pos_session_id: sessionId,
            pos_config_id: this.pos.config.id,
            user_id: userId,
            closing_date: serializeDateTime(luxon.DateTime.now()),
            total_notes: totalNotes,
            total_amount: totalAmount,
            line_ids: lineIds,
        }]);
    },

    async closeSession() {
        if (!this.pos.config.show_cash_denominations) {
            return super.closeSession(...arguments);
        }

        try {
            await this.saveCashDenominationData();
        } catch (error) {
            await this.popup.add(ErrorPopup, {
                title: _t("Error"),
                body: _t(
                    "Failed to save cash denomination data. Session closing aborted: %s",
                    error.data?.message || error.message
                ),
            });
            return;
        }

        return super.closeSession(...arguments);
    },
});
