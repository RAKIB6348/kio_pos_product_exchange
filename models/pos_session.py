
from email.utils import parseaddr

from odoo import models, _
from odoo.exceptions import UserError


BRANCH_INVENTORY_USER_GROUP = "kio_branch_inventory.group_branch_inventory_user"
CASH_DENOMINATION_REQUIRED_MESSAGE = _(
    "Please enter cash denomination details before closing the POS session."
)


class PosSession(models.Model):
    _inherit = "pos.session"

    def _get_cash_denomination_requirement(self):
        """Return the denomination requirement from the session closing data.

        `_get_closed_orders()` and `amount_total` are intentionally the same
        values used by Odoo's closing popup.  Do not base this on frontend
        text or on cash-control/payment-method amounts.
        """
        self.ensure_one()
        orders = self._get_closed_orders()
        total_amount = sum(orders.mapped("amount_total"))
        is_branch_user = self.env.user.has_group(BRANCH_INVENTORY_USER_GROUP)
        required = bool(
            self.config_id.show_cash_denominations
            and is_branch_user
            and len(orders) > 0
            and self.currency_id.compare_amounts(total_amount, 0) > 0
        )
        return {
            "required": required,
            "total_orders": len(orders),
            "total_amount": total_amount,
        }

    def get_cash_denomination_validation_status(self):
        """RPC endpoint used by the closing popup before it saves data."""
        self.ensure_one()
        return self._get_cash_denomination_requirement()

    def _has_valid_cash_denomination(self):
        self.ensure_one()
        denomination = self.env["pos.cash.denomination"].sudo().search(
            [("pos_session_id", "=", self.id)], limit=1
        )
        return bool(denomination.line_ids.filtered(lambda line: line.note_qty > 0))

    def _check_cash_denomination_requirement(self):
        for session in self:
            if (
                session._get_cash_denomination_requirement()["required"]
                and not session._has_valid_cash_denomination()
            ):
                raise UserError(CASH_DENOMINATION_REQUIRED_MESSAGE)

    def _cannot_close_session(self, bank_payment_method_diffs=None):
        result = super()._cannot_close_session(bank_payment_method_diffs)
        if result:
            return result
        try:
            self._check_cash_denomination_requirement()
        except UserError as error:
            return {"successful": False, "message": error.args[0], "redirect": False}

    def _validate_session(self, balancing_account=False, amount_to_balance=0, bank_payment_method_diffs=None):
        # Keep this final server-side check for backend/RPC closing paths that
        # do not call close_session_from_ui().
        self._check_cash_denomination_requirement()
        return super()._validate_session(
            balancing_account, amount_to_balance, bank_payment_method_diffs
        )

    def message_post(self, **kwargs):
        self.ensure_one()

        is_closing_message = (
            kwargs.get("body") == "Point of Sale Session ended"
        )

        if is_closing_message and not kwargs.get("email_from"):

            company = self.company_id

            company_email = (
                company.email
                or company.partner_id.email
                or ""
            ).strip()

            parsed_email = parseaddr(company_email)[1]

            if (
                not parsed_email
                or "@" not in parsed_email
                or "." not in parsed_email.split("@")[-1]
            ):
                raise UserError(_(
                    "A valid company email address is required "
                    "to post the POS session closing message."
                ))

            # Actual logged-in Odoo user who closes the session.
            closing_user = self.env.user

            # Keep the closing user as the chatter author.
            kwargs["author_id"] = closing_user.partner_id.id

            # Use company email only as the sender fallback.
            kwargs["email_from"] = company_email

        return super().message_post(**kwargs)
