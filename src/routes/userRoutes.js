const express = require("express");
const {
  getProfileHandler,
  updateProfileHandler,
  leaveVirtualRoomHandler,
  getCounselingQuestionaireHandler,
  getUsersHandler,
  getMyConversationsHandler,
  getMyConversationDataHandler,
  createConversationHandler,
  getCounselingTypeHandler,
  loadConversationMessagesHandler,
  getCoursesHandler,
  referClientHandler,
  getNotificationsHandler,
  getCounselorsHandler,
  getAnnouncementHandler,
} = require("../controllers/userController");
const { 
  requiresPermission 
} = require("../middleware/authMiddleware");

const router = express.Router();

router.get(
  "/self",
  requiresPermission(),
  getProfileHandler
);
router.patch(
  "/self", 
  requiresPermission(), 
  updateProfileHandler
);
router.patch(
  "/counseling/virtual_room/:room_id",
  requiresPermission(),
  leaveVirtualRoomHandler
);
router.get(
  "/counseling/questions",
  requiresPermission(),
  getCounselingQuestionaireHandler
);
router.get(
  "/users",
  requiresPermission(),
  getUsersHandler
);
router.post(
  "/conversation",
  requiresPermission(),
  createConversationHandler
);
router.get(
  "/conversations",
  requiresPermission(),
  getMyConversationsHandler
);
router.get(
  "/conversation/:conversation_id/messages",
  requiresPermission(),
  loadConversationMessagesHandler
);
router.get(
  "/conversation/:conversation_id",
  requiresPermission(),
  getMyConversationDataHandler
);
router.get(
  "/counseling/type",
  requiresPermission(),
  getCounselingTypeHandler
);
router.get(
  "/courses",
  getCoursesHandler
);
router.post(
  "/referral",
  referClientHandler
);
router.get(
  "/notifications",
  requiresPermission({}),
  getNotificationsHandler
);
router.get(
  "/counselors",
  getCounselorsHandler
);
router.get(
  "/announcements",
  requiresPermission({}),
  getAnnouncementHandler
);


module.exports = router;
