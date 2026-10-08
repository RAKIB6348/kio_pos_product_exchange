
from email.utils import parseaddr

from odoo import models, _
from odoo.exceptions import UserError


class PosSession(models.Model):
    _inherit = "pos.session"

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
