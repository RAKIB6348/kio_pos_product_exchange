# -*- coding: utf-8 -*-
# from odoo import http


# class KioPosProductExchange(http.Controller):
#     @http.route('/kio_pos_product_exchange/kio_pos_product_exchange', auth='public')
#     def index(self, **kw):
#         return "Hello, world"

#     @http.route('/kio_pos_product_exchange/kio_pos_product_exchange/objects', auth='public')
#     def list(self, **kw):
#         return http.request.render('kio_pos_product_exchange.listing', {
#             'root': '/kio_pos_product_exchange/kio_pos_product_exchange',
#             'objects': http.request.env['kio_pos_product_exchange.kio_pos_product_exchange'].search([]),
#         })

#     @http.route('/kio_pos_product_exchange/kio_pos_product_exchange/objects/<model("kio_pos_product_exchange.kio_pos_product_exchange"):obj>', auth='public')
#     def object(self, obj, **kw):
#         return http.request.render('kio_pos_product_exchange.object', {
#             'object': obj
#         })

