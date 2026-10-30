const express = require('express');
const { createFinanceController } = require('../controllers/finance.controller');
const { createAuthenticate } = require('../middleware/authenticate');
const { csrfProtection } = require('../middleware/csrfProtection');
const { requirePermissions } = require('../middleware/authorize');
const { requireSocietyContext } = require('../middleware/requireSocietyContext');
const { validateRequest } = require('../middleware/validateRequest');
const schemas = require('../validators/finance.validators');

function createFinanceRouter({ models, audit, financeService }) {
  const router = express.Router();
  const controller = createFinanceController({ financeService });
  const authenticate = createAuthenticate({ models, audit });
  const societyContext = requireSocietyContext({ models, audit });
  const root = '/societies/:societyId/finance';

  function scoped(method, path, permission, { params, query, body } = {}, handler) {
    router[method](
      `${root}${path}`,
      authenticate,
      ...(method === 'get' ? [] : [csrfProtection]),
      validateRequest({
        params: params ?? schemas.societyParams,
        ...(query ? { query } : {}),
        ...(body ? { body } : {}),
      }),
      societyContext,
      requirePermissions(audit, permission),
      handler,
    );
  }

  scoped('get', '/gateway', 'finance:manage', {}, controller.getGateway);
  scoped(
    'put',
    '/gateway',
    'finance:manage',
    { body: schemas.gatewaySchema },
    controller.configureGateway,
  );
  scoped(
    'post',
    '/payments',
    'billing:read',
    { body: schemas.paymentSchema },
    controller.createPayment,
  );
  scoped('get', '/payments', 'billing:read', {}, controller.listPayments);
  scoped(
    'post',
    '/payments/:paymentId/refunds',
    'finance:manage',
    {
      params: schemas.paymentParams,
      body: schemas.refundSchema,
    },
    controller.requestRefund,
  );
  scoped(
    'post',
    '/payments/:paymentId/refunds/:refundId/approve',
    'finance:manage',
    {
      params: schemas.refundParams,
      body: schemas.emptyBody,
    },
    controller.approveRefund,
  );
  scoped('get', '/accounts', 'finance:read', {}, controller.listAccounts);
  scoped(
    'post',
    '/accounts',
    'finance:manage',
    { body: schemas.accountSchema },
    controller.createAccount,
  );
  scoped('get', '/vendors', 'finance:read', {}, controller.listVendors);
  scoped(
    'post',
    '/vendors',
    'finance:manage',
    { body: schemas.vendorSchema },
    controller.createVendor,
  );
  scoped('get', '/expenses', 'finance:read', {}, controller.listExpenses);
  scoped(
    'post',
    '/expenses',
    'finance:manage',
    { body: schemas.expenseSchema },
    controller.createExpense,
  );
  scoped(
    'post',
    '/expenses/:expenseId/approve',
    'finance:manage',
    {
      params: schemas.expenseParams,
      body: schemas.emptyBody,
    },
    controller.approveExpense,
  );
  scoped(
    'post',
    '/expenses/:expenseId/payments',
    'finance:manage',
    {
      params: schemas.expenseParams,
      body: schemas.vendorPaymentSchema,
    },
    controller.recordVendorPayment,
  );
  scoped(
    'post',
    '/expenses/:expenseId/payments/:vendorPaymentId/reverse',
    'finance:manage',
    {
      params: schemas.vendorPaymentParams,
      body: schemas.expenseReversalSchema,
    },
    controller.reverseVendorPayment,
  );
  scoped(
    'post',
    '/expenses/:expenseId/reverse',
    'finance:manage',
    {
      params: schemas.expenseParams,
      body: schemas.expenseReversalSchema,
    },
    controller.reverseExpense,
  );
  scoped(
    'get',
    '/reports/summary',
    'finance:read',
    { query: schemas.reportQuery },
    controller.getReport,
  );
  scoped(
    'get',
    '/journals',
    'finance:read',
    { query: schemas.reportQuery },
    controller.listJournals,
  );
  scoped(
    'post',
    '/settlements',
    'finance:manage',
    {
      body: schemas.settlementSchema,
    },
    controller.createSettlement,
  );
  scoped(
    'post',
    '/reconciliation/import',
    'finance:manage',
    {
      body: schemas.importStatementSchema,
    },
    controller.importStatement,
  );
  scoped(
    'get',
    '/reconciliation/lines',
    'finance:read',
    {
      query: schemas.reconciliationQuery,
    },
    controller.listStatementLines,
  );
  scoped(
    'post',
    '/reconciliation/lines/:lineId/match',
    'finance:manage',
    {
      params: schemas.matchParams,
      body: schemas.matchSchema,
    },
    controller.reconcileLine,
  );
  return router;
}

function createRazorpayWebhookRouter({ financeService }) {
  const router = express.Router();
  router.post(
    '/razorpay/:societyId',
    express.raw({ type: 'application/json', limit: '1mb' }),
    async (request, response, next) => {
      try {
        const { societyId } = schemas.societyParams.parse(request.params);
        const result = await financeService.processWebhook({
          societyId,
          rawBody: request.body,
          signature: request.get('x-razorpay-signature'),
          eventId: request.get('x-razorpay-event-id'),
          request,
        });
        response.status(200).json({ received: true, ...result });
      } catch (error) {
        next(error);
      }
    },
  );
  return router;
}

module.exports = { createFinanceRouter, createRazorpayWebhookRouter };
