const { ROLE } = require("../config/serverConstants");
const { getAnnouncements } = require("../services/announcementServices");
const {
  getCounselingQuestionaire,
  getCounselingType,
  referClient,
} = require("../services/counselingServices");
const { getCourses } = require("../services/coursesServices");
const {
  loadConversationMessages,
  getMyConversationData,
  getMyConversations,
  createConversation,
} = require("../services/messagingServices");
const {
  getNotifications,
} = require("../services/notificationServices");
const {
  getProfileOrNull,
  updateProfile,
} = require("../services/profileServices");
const { getUsers } = require("../services/userServices");
const { leaveVirtualRoom } = require("../services/videoCallServices");

const getProfileHandler = async (req, res, next) => {
  try {
    var results = await getProfileOrNull({
      account_id: req.user?.accountId,
    });

    res.status(200).json({ user: results?.data });
  } catch (e) {
    return next(e);
  }
};

const updateProfileHandler = async (req, res, next) => {
  try {
    const results = await updateProfile({
      account_id: req.user?.accountId || 0,
      given_name: req.body.given_name,
      middle_name: req.body.middle_name,
      last_name: req.body.last_name,
      contact_number: req.body?.contact_number,
    });

    return res.status(204).json("Profile update success!");
  } catch (e) {
    return next(e);
  }
};

const leaveVirtualRoomHandler = async (req, res, next) => {
  try {
    const results = await leaveVirtualRoom({
      room_id: req.params?.room_id,
      account_id: req.user?.accountId,
    });

    return res.status(200).json({ message: "Left the room" });
  } catch (e) {
    return next(e);
  }
};

const getCounselingQuestionaireHandler = async (req, res, next) => {
  try {
    const results = await getCounselingQuestionaire({
      is_archived: req.query?.is_archived,
    });

    return res.status(200).json({ questions: results.data });
  } catch (e) {
    return next(e);
  }
};

const getUsersHandler = async (req, res, next) => {
  try {
    const results = await getUsers({
      search: req.query?.search,
      account_id: req.user?.accountId,
      page: req.query?.page,
      limit: req.query?.limit,
      roles: req.user?.role === ROLE.CLIENT ? [ROLE.COUNSELOR] : undefined
    });

    return res.status(200).json({ users: results.data, total_pages: results.total_pages });
  } catch (e) {
    return next(e);
  }
};

const getCounselorsHandler = async (req, res, next) => {
  try {
    const results = await getUsers({
      search: req.query?.search,
      roles: [ROLE.COUNSELOR],
      page: req.query?.page,
    });
    
    const data = results?.data?.map(({ given_name, middle_name, last_name }) => { 
      return {
        name: `${given_name} ${middle_name} ${last_name}`
      }
    });

    return res.status(200).json({ counselors: data });
  } catch (e) {
    return next(e);
  }
};

const getMyConversationsHandler = async (req, res, next) => {
  try {
    const results = await getMyConversations({
      account_id: req.user?.accountId,
      limit: req.query?.limit,
      page: req.query?.page
    });

    return res.status(200).json({ conversations: results.data, total_pages: results.total_pages});
  } catch (e) {
    return next(e);
  }
};

const getMyConversationDataHandler = async (req, res, next) => {
  try {
    const results = await getMyConversationData({
      conversation_id: req.params?.conversation_id,
      account_id: req.user?.accountId,
    });

    return res.status(200).json({ conversation_data: results.data });
  } catch (e) {
    return next(e);
  }
};

const createConversationHandler = async (req, res, next) => {
  try {
    const results = await createConversation({
      creator_id: req.user?.accountId,
      recipient_id: req.body?.recipient_id,
    });

    return res.status(201).json({ conversation_data: results.data });
  } catch (e) {
    return next(e);
  }
};

const getCounselingTypeHandler = async (req, res, next) => {
  try {
    const results = await getCounselingType({});

    return res.status(200).json({ types: results.data });
  } catch (e) {
    return next(e);
  }
};

const loadConversationMessagesHandler = async (req, res, next) => {
  try {
    const results = await loadConversationMessages({
      account_id: req.user?.accountId,
      conversation_id: req.params?.conversation_id,
      limit: 20,
      before_id: req.query?.before_id,
    });

    return res.status(200).json({ messages: results.data });
  } catch (e) {
    return next(e);
  }
};

const getCoursesHandler = async (req, res, next) => {
  try {
    const results = await getCourses({});

    const data = results?.data.map(({ name, id }) => {
      return {
        name,
        id,
      };
    });

    return res.status(200).json({ courses: data });
  } catch (e) {
    return next(e);
  }
};

const referClientHandler = async (req, res, next) => {
  try {
    const results = await referClient({
      referrer_name: req.body?.referrerName,
      client_name: req.body?.referredName,
      relation: req.body?.relation,
      reason: req.body?.reason,
      client_public_id: req.body?.studentId,
      course: req.body?.course,
      referrer_contact: req.body?.referrerContact,
      section: req.body?.section,
    });

    return res.status(201).json({ message: "Referral created" });
  } catch (e) {
    return next(e);
  }
};

const getNotificationsHandler = async (req, res, next) => {
  try {
    const results = await getNotifications({
      account_id: req.user?.accountId,
      limit: req.query?.limit || 1,
      page: req.query?.page,
    });

    const data = results?.data.map(({ message, created_at, is_read }) => {
      return { message, created_at, is_read };
    });

    return res.status(200).json({ notifications: data });
  } catch (e) {
    return next(e);
  }
};

const getAnnouncementHandler = async (req, res, next) => {
  try {
    const results = await getAnnouncements({
      role: req.user?.role,
      limit: req.query?.limit,
      page: req.query?.page,
    });

    const data = results?.data.map(({ title, content, created_at }) => {
      return { title, content, created_at };
    });

    return res.status(200).json({
      announcements: data,
      total: results.total,
      total_pages: results.total_pages,
      current_page: results.page,
    });
  } catch (e) {
    return next(e);
  }
};

module.exports = {
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
};
