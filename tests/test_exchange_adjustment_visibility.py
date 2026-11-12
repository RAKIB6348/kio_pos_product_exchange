from unittest.mock import patch

from odoo.tests import TransactionCase, tagged
from odoo.addons.point_of_sale.models.pos_session import PosSession as CorePosSession

from ..models import pos_order as exchange_pos_order


@tagged("post_install", "-at_install")
class TestExchangeAdjustmentVisibility(TransactionCase):
    def test_existing_adjustment_product_is_hidden_without_other_changes(self):
        company = self.env.company
        code = "TEST_POS_EXCHANGE_ADJUSTMENT_VISIBILITY"
        taxes = self.env["account.tax"].search(
            [("company_id", "=", company.id), ("type_tax_use", "=", "sale")],
            limit=1,
        )
        income_account = self.env["account.account"].search(
            [
                ("company_id", "=", company.id),
                ("account_type", "in", ("income", "income_other")),
            ],
            limit=1,
        )
        values = {
            "name": "Test Exchange Adjustment Fee",
            "default_code": code,
            "detailed_type": "service",
            "sale_ok": True,
            "purchase_ok": False,
            "available_in_pos": True,
            "active": True,
            "list_price": 42.0,
            "company_id": company.id,
            "taxes_id": [(6, 0, taxes.ids)],
        }
        if income_account:
            values["property_account_income_id"] = income_account.id
        template = self.env["product.template"].create(values)
        product = template.product_variant_id

        with patch.object(exchange_pos_order, "EXCHANGE_ADJUSTMENT_CODE", code):
            ensured_product = self.env["pos.order"]._ensure_exchange_adjustment_product()

        self.assertEqual(ensured_product, product)
        self.assertEqual(ensured_product.id, product.id)
        self.assertFalse(template.available_in_pos)
        self.assertTrue(template.active)
        self.assertEqual(product.default_code, code)
        self.assertEqual(template.detailed_type, "service")
        self.assertEqual(template.taxes_id, taxes)
        if income_account:
            self.assertEqual(
                template.with_company(company).property_account_income_id,
                income_account,
            )

        # A POS bootstrap must repair the flag before the core loader builds
        # its available_in_pos product domain.
        template.available_in_pos = True
        with (
            patch.object(exchange_pos_order, "EXCHANGE_ADJUSTMENT_CODE", code),
            patch.object(CorePosSession, "load_pos_data", return_value={"loaded": True}),
        ):
            result = self.env["pos.session"].browse().load_pos_data()

        self.assertEqual(result, {"loaded": True})
        self.assertFalse(template.available_in_pos)

        config = self.env["pos.config"].create(
            {"name": "Exchange Internal Loader Test"}
        )
        session = self.env["pos.session"].create(
            {
                "config_id": config.id,
                "name": "TEST/EXCHANGE/INTERNAL/LOADER",
                "user_id": self.env.uid,
            }
        )
        with patch.object(exchange_pos_order, "EXCHANGE_ADJUSTMENT_CODE", code):
            product_data = self.env["pos.order"].get_exchange_adjustment_product_data(
                session.id
            )
        self.assertEqual(product_data["id"], product.id)
        self.assertFalse(product_data["available_in_pos"])
        self.assertFalse(
            self.env["product.product"].search_count(
                config._get_available_product_domain() + [("id", "=", product.id)]
            )
        )
