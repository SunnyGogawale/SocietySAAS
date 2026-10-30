const express = require('express');
const { createBillingController } = require('../controllers/billing.controller');
const { createAuthenticate } = require('../middleware/authenticate');
const { csrfProtection } = require('../middleware/csrfProtection');
const { requirePermissions } = require('../middleware/authorize');
const { requireSocietyContext } = require('../middleware/requireSocietyContext');
const { validateRequest } = require('../middleware/validateRequest');
const schemas = require('../validators/billing.validators');

function createBillingRouter({ models, audit, billingService, financeService }) {
  const router = express.Router();
  const controller = createBillingController({ billingService, financeService });
  const authenticate = createAuthenticate({ models, audit });
  const societyContext = requireSocietyContext({ models, audit });
  const root = '/societies/:societyId/billing';

  function scoped(method, path, permission, schema, handler) {
    router[method](
      `${root}${path}`,
      authenticate,
      ...(method === 'get' ? [] : [csrfProtection]),
      validateRequest({
        params: schema.params ?? require('../validators/auth.validators').societyIdParamsSchema,
        ...(schema.query ? { query: schema.query } : {}),
        ...(schema.body ? { body: schema.body } : {}),
      }),
      societyContext,
      requirePermissions(audit, permission),
      handler,
    );
  }

  scoped('get', '/bills', 'billing:read', { query: schemas.listBillsQuery }, controller.listBills);
  scoped(
    'get',
    '/bills/:billId',
    'billing:read',
    { params: schemas.billParams },
    controller.getBill,
  );
  scoped(
    'get',
    '/bills/:billId/pdf',
    'billing:read',
    { params: schemas.billParams },
    controller.downloadPdf,
  );
  scoped('get', '/runs', 'billing:manage', {}, controller.listRuns);
  scoped(
    'post',
    '/runs/preview',
    'billing:manage',
    { body: schemas.recurringRunSchema },
    controller.previewRun,
  );
  scoped(
    'post',
    '/runs/:runId/:action',
    'billing:manage',
    { params: schemas.runActionParams, body: schemas.emptyBody },
    controller.transitionRun,
  );
  scoped(
    'post',
    '/ad-hoc',
    'billing:manage',
    { body: schemas.standaloneBillSchema },
    controller.createAdHoc,
  );
  scoped(
    'post',
    '/opening-balances',
    'billing:manage',
    { body: schemas.openingBalanceSchema },
    controller.createOpeningBalance,
  );
  scoped(
    'post',
    '/opening-balances/import',
    'billing:manage',
    { body: schemas.openingBalanceImportSchema },
    controller.importOpeningBalances,
  );
  scoped(
    'post',
    '/receipts',
    'billing:manage',
    { body: schemas.receiptSchema },
    controller.recordReceipt,
  );
  scoped('get', '/ageing', 'billing:read', {}, controller.getAgeing);
  scoped(
    'post',
    '/reminders/issue',
    'billing:manage',
    { body: schemas.reminderSchema },
    controller.issueReminders,
  );
  scoped('get', '/reminders', 'billing:read', {}, controller.getReminders);
  scoped(
    'post',
    '/reminders/:reminderId/read',
    'billing:read',
    { params: schemas.markReminderParams, body: schemas.emptyBody },
    controller.markReminderRead,
  );
  scoped(
    'post',
    '/late-fees/assess',
    'billing:manage',
    { body: schemas.emptyBody },
    controller.assessLateFees,
  );
  scoped(
    'post',
    '/bills/:billId/cancel',
    'billing:manage',
    { params: schemas.billParams, body: schemas.cancelBillSchema },
    controller.cancelBill,
  );
  scoped(
    'post',
    '/bills/:billId/revisions',
    'billing:manage',
    { params: schemas.billParams, body: schemas.revisionSchema },
    controller.reviseBill,
  );
  scoped(
    'post',
    '/bills/:billId/adjustments',
    'billing:manage',
    { params: schemas.billParams, body: schemas.creditNoteSchema },
    controller.createAdjustment,
  );
  scoped(
    'post',
    '/bills/:billId/:action',
    'billing:manage',
    { params: schemas.billActionParams, body: schemas.emptyBody },
    controller.transitionBill,
  );
  scoped(
    'post',
    '/adjustments/:adjustmentId/:action',
    'billing:manage',
    { params: schemas.adjustmentActionParams, body: schemas.emptyBody },
    controller.transitionAdjustment,
  );
  return router;
}

module.exports = { createBillingRouter };
