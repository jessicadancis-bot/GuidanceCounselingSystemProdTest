const express = require("express");
const { requiresPermission } = require("../middleware/authMiddleware");
const { PERMISSIONS } = require("../config/permissionsConfig");
const { createCounselingCaseSessionHandler, updateCounselorCaseHandler, updateCounselorCaseSessionHandler, activateVirtualRoomHandler, deactivateVirtualRoomHandler, terminateCounselorCaseSessionHandler, terminateCounselorCaseHandler, generateCaseReportHandler, getClientCaseRecordsHandler, getSeverityLevelsHandler, getIntakeFormHandler, getClientsHandler, acceptCounselingRequestHandler, getCounselingRequestsHandler, getCounselingRequestHandler, getCaseSessionsHandler, getCounselorCasesHandler, getReferralsHandler, handleReferralHandler, getHandledReferrals, closeReferralHandler, addCaseCollaboratorHandler, getCaseCollaboratorsHandler, getCaseAnalyticsHandler, attachVirtualRoomToSessionHandler, getSessionAttachedVirtualRoomsHandler, removeAttachedVirtualRoomHandler, getSessionAttachmentsHandler, addSessionAttachmentHandler, removeSessionAttachmentHandler, getCounselingSchedulesHandler, createCaseForHandler, getCounselorsHandler, removeCaseCollaboratorHandler } = require("../controllers/counselorController");

const router = express.Router();

router.get(
  "/counseling/cases",
  requiresPermission({permission : [PERMISSIONS.GET_CASES]}),
  getCounselorCasesHandler
);
router.get(
  "/counseling/case/:case_id/sessions",
  requiresPermission({ permission: [PERMISSIONS.GET_SESSIONS]}),
  getCaseSessionsHandler
);
router.patch(
  "/counseling/case/:case_id",
  requiresPermission({ permission: [PERMISSIONS.UPDATE_CASE] }),
  updateCounselorCaseHandler
);
router.post(
  "/counseling/case/:case_id/session",
  requiresPermission({permission : [PERMISSIONS.CREATE_SESSION]}),
  createCounselingCaseSessionHandler
);
router.patch(
  "/counseling/case/:case_id/session/:session_id",
  requiresPermission({ permission: [PERMISSIONS.UPDATE_SESSION]}),
  updateCounselorCaseSessionHandler
);
router.post(
  "/counseling/case/:reference_id/accept",
  requiresPermission({ permission: [PERMISSIONS.ACCEPT_AVAILABLE_REQUEST] }),
  acceptCounselingRequestHandler
);
router.get(
  "/counseling/cases/requests",
  requiresPermission({ permission: [PERMISSIONS.GET_AVAILABLE_REQUESTS] }),
  getCounselingRequestsHandler
);
router.get(
  "/counseling/cases/request/:reference_id",
  requiresPermission({ permission: [PERMISSIONS.GET_AVAILABLE_REQUESTS] }),
  getCounselingRequestHandler
);
router.patch(
  "/counseling/case/:case_id/session/:session_id/terminate",
  requiresPermission({ permission: [PERMISSIONS.UPDATE_CASE] }),
  terminateCounselorCaseSessionHandler
);
router.patch(
  "/counseling/case/:case_id/terminate",
  requiresPermission({ permission: [PERMISSIONS.UPDATE_CASE] }),
  terminateCounselorCaseHandler
);
router.patch(
  "/virtual_room/:room_id/open",
  requiresPermission({ permission: [PERMISSIONS.UPDATE_VIRTUAL_ROOM] }),
  activateVirtualRoomHandler
);
router.patch(
  "/virtual_room/:room_id/close",
  requiresPermission({ permission: [PERMISSIONS.UPDATE_VIRTUAL_ROOM] }),
  deactivateVirtualRoomHandler
);
router.get(
  "/counseling/request/:reference_id/intake/answers",
  requiresPermission({ permission: [PERMISSIONS.GET_INTAKE_FORM] }),
  getIntakeFormHandler
);
router.post(
  "/counseling/cases/generate_report",
  requiresPermission({ permission: [PERMISSIONS.GET_GENERATED_CASE_REPORT] }),
  generateCaseReportHandler
);
router.get(
  "/client/:public_id/counseling/cases",
  requiresPermission({ permission: [PERMISSIONS.GET_CASES]}),
  getClientCaseRecordsHandler
);
router.get(
  "/severity_levels",
  requiresPermission({}),
  getSeverityLevelsHandler
);
router.get(
  "/clients",
  requiresPermission({ permission: [PERMISSIONS.GET_CLIENTS] }),
  getClientsHandler
);
router.get(
  "/referrals",
  requiresPermission({ permission: [PERMISSIONS.GET_REFERRALS] }),
  getReferralsHandler
);
router.get(
  "/referrals/accepted",
  requiresPermission({ permission: [PERMISSIONS.GET_REFERRALS] }),
  getHandledReferrals
);
router.patch(
  "/referral/:id/undertake",
  requiresPermission({ permission: [PERMISSIONS.ACCEPT_REFERRALS] }),
  handleReferralHandler
);
router.patch(
  "/referral/:id/close",
  requiresPermission({ permission: [PERMISSIONS.UPDATE_REFERRALS] }),
  closeReferralHandler
);
router.post(
  "/case/:id/collaborator",
  requiresPermission({ permission: [PERMISSIONS.UPDATE_CASE] }),
  addCaseCollaboratorHandler
);
router.delete(
  "/case/:id/collaborator/:collaborator_id",
  requiresPermission({ permission: [PERMISSIONS.UPDATE_CASE] }),
  removeCaseCollaboratorHandler
);
router.get(
  "/case/:id/collaborators",
  requiresPermission({ permission: [PERMISSIONS.GET_CASES] }),
  getCaseCollaboratorsHandler
);
router.get(
  "/case/analytics",
  requiresPermission({ permission: [PERMISSIONS.GET_ANALYTICS] }),
  getCaseAnalyticsHandler
);
router.post(
  "/case/:case_id/session/:id/attach_virtual_room",
  requiresPermission({ permission: [PERMISSIONS.UPDATE_CASE] }),
  attachVirtualRoomToSessionHandler
);
router.post(
  "/case/:case_id/session/:id/deattach_virtual_room",
  requiresPermission({ permission: [PERMISSIONS.UPDATE_CASE] }),
  removeAttachedVirtualRoomHandler
);
router.get(
  "/case/session/:id/attached_rooms",
  requiresPermission({ permission: [PERMISSIONS.GET_CASE] }),
  getSessionAttachedVirtualRoomsHandler
);
router.get(
  "/case/session/:id/attachment",
  requiresPermission({ permission: [PERMISSIONS.GET_CASE] }),
  getSessionAttachmentsHandler
);
router.post(
  "/case/session/:id/attachment",
  requiresPermission({ permission: [PERMISSIONS.UPDATE_CASE] }),
  addSessionAttachmentHandler
);
router.post(
  "/case/session/:id/attachment/:attachment_id/remove",
  requiresPermission({ permission: [PERMISSIONS.UPDATE_CASE] }),
  removeSessionAttachmentHandler
);
router.get(
  "/calendar",
  requiresPermission({}),
  getCounselingSchedulesHandler
);
router.post(
  "/client/:user_id/case",
  requiresPermission({ permission: [PERMISSIONS.ACCEPT_CASE] }),
  createCaseForHandler
);
router.get(
  "/counselors",
  requiresPermission({ permission: [PERMISSIONS.GET_COUNSELORS]}),
  getCounselorsHandler
);

module.exports = router;
