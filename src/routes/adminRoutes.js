const express = require("express");
const { requiresPermission} = require("../middleware/authMiddleware");
const { PERMISSIONS } = require("../config/permissionsConfig");
const { getCounselingRequestHandler, getCounselingCasesForMonitoringHandler, createAnnouncementHandler, updateAccountsHandler, getAccountsHandler, getAnnouncementHandler, deleteAnnouncementHandler } = require("../controllers/adminController");

const router = express.Router();

router.get(
  "/counseling/request",
  requiresPermission({ permission : [PERMISSIONS.GET_REQUEST]}),
  getCounselingRequestHandler
);
router.get(
  "/counseling/case/monitoring",
  requiresPermission({ permission : [PERMISSIONS.GET_CASE_FOR_MONITORING]}),
  getCounselingCasesForMonitoringHandler
);
router.get(
  "/accounts",
  requiresPermission({ permission : [PERMISSIONS.GET_ACCOUNTS] }),
  getAccountsHandler
);
router.patch(
  "/account/:account_id",
  requiresPermission({ permission : [PERMISSIONS.UPDATE_ACCOUNT_INFORMATIONS] }),
  updateAccountsHandler
);
router.post(
  "/announcement",
  requiresPermission({ permission : [PERMISSIONS.CREATE_ANNOUNCEMENT] }),
  createAnnouncementHandler
);
router.get(
  "/announcements",
  requiresPermission({ permission: [PERMISSIONS.GET_ANNOUNCEMENT] }),
  getAnnouncementHandler
);
router.delete(
  "/announcement/:id/remove",
  requiresPermission({ permission : [PERMISSIONS.UPDATE_ANNOUNCEMENT] }),
  deleteAnnouncementHandler
);

module.exports = router;
