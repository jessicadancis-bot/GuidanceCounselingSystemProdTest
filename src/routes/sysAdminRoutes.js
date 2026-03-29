const express = require("express");
const multer = require("multer");
const upload = multer({ dest: "uploads/"});
const { requiresPermission } = require("../middleware/authMiddleware");
const { PERMISSIONS } = require("../config/permissionsConfig");
const { createCourseHandler, getCoursesHandler, getAccountsHandler, updateAccountHandler, archiveAccountHandler, addRolePermissionHandler, getPermissionsHandler, createRoleHandler, getRolesHandler, updateCourseHandler, getCourseDataHandler, getAccountDataHandler, addCounselingQuestionHandler, updateCounselingQuestionHandler, archiveCounselingQuestionHandler, archiveCourseHandler, getCounselingQuestionsHandler, getAuditLogsHandler, disableAccountHandler, batchRegisterAccountsHandler, registerAccountHandler, createDepartmentHandler, getDepartmentsHandler, updateDepartmentHandler, batchArchiveAccountsHandler, archiveDepartmentHandler, backupDatabaseHandler, getAccountsAnalyticsHandler } = require("../controllers/sysAdminController");

const router = express.Router();

router.post(
  "/register",
  requiresPermission({permission : [PERMISSIONS.CREATE_ACCOUNT]}),
  registerAccountHandler
);
router.post(
  "/accounts/insert/csv",
  requiresPermission({ permission: [PERMISSIONS.CREATE_ACCOUNT] }),
  upload.single("csv"),
  batchRegisterAccountsHandler
);
router.post(
  "/accounts/archive/csv",
  requiresPermission({ permission: [PERMISSIONS.UPDATE_ACCOUNT] }),
  upload.single("csv"),
  batchArchiveAccountsHandler
);
router.post(
  "/course",
  requiresPermission({ permission: [PERMISSIONS.CREATE_COURSE] }),
  createCourseHandler
);
router.get(
  "/courses",
  requiresPermission({ permission : [PERMISSIONS.GET_COURSES] }),
  getCoursesHandler
);
router.get(
  "/course/:course_code",
  requiresPermission({ permission : [PERMISSIONS.GET_COURSES] }),
  getCourseDataHandler
);
router.patch(
  "/course/:course_code",
  requiresPermission({ permission : [PERMISSIONS.UPDATE_COURSE]}),
  updateCourseHandler
);
router.patch(
  "/course/:course_code/archive",
  requiresPermission({ permission : [PERMISSIONS.UPDATE_COURSE]}),
  archiveCourseHandler
);
router.get(
  "/accounts",
  requiresPermission({permission : [PERMISSIONS.GET_ACCOUNTS]}),
  getAccountsHandler
);
router.get(
  "/account/:account_id",
  requiresPermission({permission : [PERMISSIONS.GET_ACCOUNTS]}),
  getAccountDataHandler
);
router.patch(
  "/account/:account_id",
  requiresPermission({permission : [PERMISSIONS.UPDATE_ACCOUNT]}),
  updateAccountHandler
);
router.patch(
  "/account/:account_id/archive",
  requiresPermission({ permission: [PERMISSIONS.UPDATE_ACCOUNT] }),
  archiveAccountHandler
);
router.patch(
  "/account/:account_id/disable",
  requiresPermission({ permission: [PERMISSIONS.UPDATE_ACCOUNT] }),
  disableAccountHandler
);
router.post(
  "/role/permission",
  requiresPermission({permission : [PERMISSIONS.SET_PERMISSION]}),
  addRolePermissionHandler
);
router.get(
  "/permissions",
  requiresPermission({permission: [PERMISSIONS.GET_PERMISSIONS]}),
  getPermissionsHandler
);
router.post(
  "/role",
  requiresPermission({permission: [PERMISSIONS.CREATE_ROLE]}),
  createRoleHandler
);
router.get(
  "/roles",
  requiresPermission({permission: [PERMISSIONS.GET_ROLE]}),
  getRolesHandler
);
router.post(
  "/counseling/question",
  requiresPermission({ permission: [PERMISSIONS.CREATE_COUNSELING_QUESTION] }),
  addCounselingQuestionHandler
);
router.patch(
  "/counseling/question/:question_id",
  requiresPermission({ permission: [PERMISSIONS.UPDATE_COUNSELING_QUESTION] }),
  updateCounselingQuestionHandler
);
router.patch(
  "/counseling/question/:question_id/archive",
  requiresPermission({ permission: [PERMISSIONS.UPDATE_COUNSELING_QUESTION] }),
  archiveCounselingQuestionHandler
);
router.get(
  "/counseling/questions",
  requiresPermission({ permission: [PERMISSIONS.GET_COUNSELING_QUESTIONS] }),
  getCounselingQuestionsHandler
);
router.get(
  "/audit/logs",
  requiresPermission({ permission: [PERMISSIONS.GET_AUDIT_LOGS] }),
  getAuditLogsHandler
);
router.post(
  "/department",
  requiresPermission({ permission: [PERMISSIONS.UPDATE_DEPARTMENTS] }),
  createDepartmentHandler
);
router.patch(
  "/department/:department_id",
  requiresPermission({ permission: [PERMISSIONS.UPDATE_DEPARTMENTS] }),
  updateDepartmentHandler
);
router.patch(
  "/department/:id/archive",
  requiresPermission({ permission: [PERMISSIONS.UPDATE_DEPARTMENTS] }),
  archiveDepartmentHandler
);
router.get(
  "/departments",
  requiresPermission({ permission: [PERMISSIONS.GET_DEPARTMENTS] }),
  getDepartmentsHandler
);
router.get(
  "/database/backup",
  requiresPermission({ permission: [PERMISSIONS.GET_DEPARTMENTS] }),
  backupDatabaseHandler
);
router.get(
  "/accounts/analytics",
  requiresPermission({ permission: [PERMISSIONS.GET_ACCOUNTS] }),
  getAccountsAnalyticsHandler
);

module.exports = router;
