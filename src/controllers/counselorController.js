const { ROLE } = require("../config/serverConstants");
const {
  createCounselingCaseSession,
  terminateCounselorCaseSession,
  terminateCounselorCase,
  updateCounselorCase,
  updateCounselorCaseSession,
  getSeverityLevels,
  getIntakeForm,
  acceptCounselingRequest,
  getCounselingRequests,
  getCaseSessions,
  getCases,
  getReferrals,
  handleReferral,
  closeReferral,
  addCaseCollaborator,
  getCaseCollaborators,
  getCaseAnalytics,
  attachVirtualRoomToSession,
  getSessionAttachedVirtualRooms,
  removeAttachedVirtualRoom,
  addSessionAttachment,
  removeSessionAttachment,
  getSessionAttachments,
  getCounselingSchedules,
  createCaseFor,
  removeCaseCollaborator,
} = require("../services/counselingServices");
const { generateCaseReport } = require("../services/reportServices");
const { getUsers } = require("../services/userServices");
const { getVirtualRoomData } = require("../services/videoCallServices");

const getCounselingRequestsHandler = async (req, res, next) => {
  try {
    const results = await getCounselingRequests({
      account_id: req.user?.accountId,
      search: req.query?.search,
      limit: req.query?.limit,
      page: req.query.page,
      status: req.query?.status,
    });

    return res.status(200).json({
      requests: results.data,
      total: results.total,
      total_pages: results.total_pages,
      current_page: results.page,
    });
  } catch (e) {
    return next(e);
  }
};

const getCounselingRequestHandler = async (req, res, next) => {
  try {
    const results = await getCounselingRequests({
      request_reference_id: req.params?.reference_id,
    });

    return res.status(200).json({ request: results.data });
  } catch (e) {
    return next(e);
  }
};

const acceptCounselingRequestHandler = async (req, res, next) => {
  try {
    const results = await acceptCounselingRequest({
      request_reference_id: req.params?.reference_id,
      counselor_id: req.user?.accountId,
    });

    return res.status(200).json({ request: results.data });
  } catch (e) {
    return next(e);
  }
};

const createCounselingCaseSessionHandler = async (req, res, next) => {
  try {
    const results = await createCounselingCaseSession({
      case_id: req.params?.case_id,
      counselor_id: req.user?.accountId,
      meeting_date: req.body.meeting_date,
      meeting_time: req.body.meeting_time,
      notes: req.body.notes,
    });

    return res
      .status(201)
      .json({ message: "Case session Created", session: results.data });
  } catch (e) {
    return next(e);
  }
};

const getCaseSessionsHandler = async (req, res, next) => {
  try {
    const results = await getCaseSessions({
      account_id: req.user?.accountId,
      status: req.query?.status,
      case_id: req.params?.case_id,
    });

    return res.status(200).json({ sessions: results.data });
  } catch (e) {
    return next(e);
  }
};

const getCounselorCasesHandler = async (req, res, next) => {
  try {
    const results = await getCases({
      counselor_id: req.user?.accountId,
      search: req.query?.search,
      limit: req.query?.limit,
      page: req.query?.page,
      status: req.query?.status,
    });

    const data = results?.data?.map(
      ({
        case_id,
        request_reference_id,
        created_at,
        updated_at,
        year_level,
        section,
        course,
        reason,
        counseling_type_id,
        counseling_type_name,
        assessment,
        notes,
        outcome,
        severity_level,
        severity_name,
        status_name,
        status_id,
        request_type_id,
        request_type_name,
        client_name,
        client_given_name,
        client_middle_name,
        client_last_name,
        client_id,
        next_meeting,
        next_meeting_end,
        case_role,
        collaborator_count
      }) => {
        return {
          case_id,
          request_reference_id,
          created_at,
          updated_at,
          year_level,
          section,
          course,
          reason,
          counseling_type_id,
          counseling_type_name,
          assessment,
          notes,
          outcome,
          severity_level,
          severity_name,
          status_name,
          status_id,
          request_type_id,
          request_type_name,
          client_name,
          client_given_name,
          client_middle_name,
          client_last_name,
          client_id,
          next_meeting,
          next_meeting_end,
          case_role,
          collaborator_count
        };
      },
    );
    
    return res.status(200).json({
      cases: data,
      total: results.total,
      total_pages: results.total_pages,
      current_page: results.page,
    });
  } catch (e) {
    return next(e);
  }
};

const getVirtualRoomDataHandler = async (req, res, next) => {
  try {
    const results = await getVirtualRoomData({
      case_id: req.params?.case_id,
      session_id: req.params?.session_id,
      account_id: req.user.accountId,
    });

    return res.status(200).json({ room: results.data });
  } catch (e) {
    return next(e);
  }
};

const terminateCounselorCaseHandler = async (req, res, next) => {
  try {
    const results = await terminateCounselorCase({
      account_id: req.user?.accountId,
      outcome: req.body?.outcome,
      case_id: req.params?.case_id,
    });

    return res.status(200).json({ case: results.data });
  } catch (e) {
    return next(e);
  }
};

const terminateCounselorCaseSessionHandler = async (req, res, next) => {
  try {
    const results = await terminateCounselorCaseSession({
      account_id: req.user?.accountId,
      case_id: req.params?.case_id,
      session_id: req.params?.session_id,
      outcome: req.body?.outcome,
    });

    return res.status(200).json({ session: results.data });
  } catch (e) {
    return next(e);
  }
};

const updateCounselorCaseHandler = async (req, res, next) => {
  try {
    const results = await updateCounselorCase({
      account_id: req.user?.accountId,
      case_id: req.params?.case_id,
      severity_level: req.body?.severity_level,
      notes: req.body?.notes,
      assessment: req.body?.assessment,
    });

    return res.status(200).json({ updated_case: results.data });
  } catch (e) {
    return next(e);
  }
};

const updateCounselorCaseSessionHandler = async (req, res, next) => {
  try {
    const results = await updateCounselorCaseSession({
      account_id: req.user?.accountId,
      new_preferred_date: req.body?.new_preferred_date,
      new_preferred_time: req.body?.new_preferred_time,
      case_id: req.params?.case_id,
      session_id: req.params?.session_id,
      notes: req.body?.notes,
      assessment: req.body?.assessment,
      intervention_plan: req.body?.intervention_plan,
    });

    return res.status(200).json({ updated_case: results.data });
  } catch (e) {
    return next(e);
  }
};

const activateVirtualRoomHandler = async (req, res, next) => {
  try {
    const results = await roomIsOpen({
      room_id: req.params?.room_id,
      account_id: req.user?.accountId,
      is_open: true,
    });

    return res.status(200).json({ room: results.data });
  } catch (e) {
    return next(e);
  }
};

const deactivateVirtualRoomHandler = async (req, res, next) => {
  try {
    const results = await roomIsOpen({
      room_id: req.params?.room_id,
      account_id: req.user?.accountId,
      is_open: false,
    });

    return res.status(200).json({ room: results.data });
  } catch (e) {
    return next(e);
  }
};

const getIntakeFormHandler = async (req, res, next) => {
  try {
    const results = await getIntakeForm({
      request_reference_id: req.params?.reference_id,
    });

    return res.status(200).json({ intake: results.data });
  } catch (e) {
    return next(e);
  }
};

const generateCaseReportHandler = async (req, res, next) => {
  try {
    const pdf_buffer = await generateCaseReport({
      case_ids: req.body.case_ids,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="cases_report.pdf"`,
    );
    return res.send(pdf_buffer);
  } catch (e) {
    return next(e);
  }
};

const getClientCaseRecordsHandler = async (req, res, next) => {
  try {
    const results = await getCases({
      client_public_id: req.params?.public_id,
      limit: req.query?.limit || 10,
    });

    return res.status(200).json({ cases: results.data });
  } catch (e) {
    return next(e);
  }
};

const getSeverityLevelsHandler = async (req, res, next) => {
  try {
    const results = await getSeverityLevels({});

    return res.status(200).json({ severity_levels: results.data });
  } catch (e) {
    return next(e);
  }
};

const getClientsHandler = async (req, res, next) => {
  try {
    const results = await getUsers({
      search: req.query?.search,
      roles: [ROLE.CLIENT],
      account_id: req.user?.accountId,
    });

    return res.status(200).json({ clients: results.data });
  } catch (e) {
    return next(e);
  }
};

const getReferralsHandler = async (req, res, next) => {
  try {
    const results = await getReferrals({
      status: req.query.status,
      page: req.query?.page,
      search: req.query.search,
      limit: req.query?.limit,
    });

    return res.status(200).json({ referrals: results.data, total_pages: results.total_pages, total: results.total });
  } catch (e) {
    return next(e);
  }
};

const getHandledReferrals = async (req, res, next) => {
  try {
    const results = await getReferrals({
      account_id: req.user?.accountId,
      status: req.query.status,
      page: req.query?.page,
      search: req.query.search,
    });

    return res.status(200).json({ referrals: results.data });
  } catch (e) {
    return next(e);
  }
};

const handleReferralHandler = async (req, res, next) => {
  try {
    const results = await handleReferral({
      account_id: req.user?.accountId,
      referral_id: req.params?.id
    });

    return res.status(201).json({ message: "Referral undertaken" });
  } catch (e) {
    return next(e);
  }
};

const closeReferralHandler = async (req, res, next) => {
  try {
    const results = await closeReferral({
      referral_id: req.params?.id,
      account_id: req.user?.accountId,
    });

    return res.status(200).json({ message: "Referral closed" });
  } catch (e) {
    return next(e);
  }
};

const addCaseCollaboratorHandler = async (req, res, next) => {
  try {
    const results = await addCaseCollaborator({
      account_id: req.user?.accountId,
      case_id: req.params?.id,
      collaborator_public_id: req.body?.collaborator_id,
      role: "member",
    });

    return res.status(201).json({ message: "Collaborator added" });
  } catch (e) {
    return next(e);
  }
};

const removeCaseCollaboratorHandler = async (req, res, next) => {
  try {
    const results = await removeCaseCollaborator({
      account_id: req.user?.accountId,
      case_id: req.params?.id,
      collaborator_public_id: req.params?.collaborator_id,
    });

    return res.status(201).json({ message: "Collaborator removed" });
  } catch (e) {
    return next(e);
  }
};

const getCaseCollaboratorsHandler = async (req, res, next) => {
  try {
    const results = await getCaseCollaborators({
      case_id: req.params?.id,
    });

    const data = results?.data?.map(
      ({ public_id, given_name, middle_name, last_name, role }) => {
        return {
          role,
          public_id,
          given_name,
          middle_name,
          last_name,
        };
      },
    );

    return res.status(200).json({ collaborators: data });
  } catch (e) {
    return next(e);
  }
};

const getCaseAnalyticsHandler = async (req, res, next) => {
  try {
    const results = await getCaseAnalytics({});

    return res.status(200).json({ analytics: results.data });
  } catch (e) {
    return next(e);
  }
};

const attachVirtualRoomToSessionHandler = async (req, res, next) => {
   try {
    const results = await attachVirtualRoomToSession({
      account_id: req.user?.accountId,
      case_id: req.params.case_id,
      session_id: req.params?.id,
      room_id: req.body?.room_id
    });

    return res.status(201).json({ message: "Room attached" });
  } catch (e) {
    return next(e);
  }
};

const removeAttachedVirtualRoomHandler = async (req, res, next) => {
   try {
    const results = await removeAttachedVirtualRoom({
      account_id: req.user?.accountId,
      session_id: req.params?.id,
      case_id: req.params?.case_id
    });

    return res.status(201).json({ message: "Room deattached" });
  } catch (e) {
    return next(e);
  }
};

const getSessionAttachedVirtualRoomsHandler = async (req, res, next) => {
   try {
    const results = await getSessionAttachedVirtualRooms({
      account_id: req.user?.accountId,
      session_id: req.params?.id,
    });

    return res.status(201).json({ virtual_rooms: results.data });
  } catch (e) {
    return next(e);
  }
};

const addSessionAttachmentHandler = async (req, res, next) => {
   try {
    const results = await addSessionAttachment({
      account_id: req.user?.accountId,
      session_id: req.params?.id,
      link: req.body?.link
    });

    return res.status(201).json({ message: "Link attached" });
  } catch (e) {
    return next(e);
  }
};

const removeSessionAttachmentHandler = async (req, res, next) => {
   try {
    const results = await removeSessionAttachment({
      account_id: req.user?.accountId,
      session_id: req.params?.id,
      attachment_id: req.params?.attachment_id
    });

    return res.status(200).json({ message: "Link attached" });
  } catch (e) {
    return next(e);
  }
};

const getSessionAttachmentsHandler = async (req, res, next) => {
   try {
    const results = await getSessionAttachments({
      account_id: req.user?.accountId,
      session_id: req.params?.id,
    });

    return res.status(200).json({ attachments: results.data });
  } catch (e) {
    return next(e);
  }
};

const getCounselingSchedulesHandler = async (req, res, next) => {
  try {
    const results = await getCounselingSchedules({
      account_id: req.user?.accountId
    });

    return res.status(200).json({ schedules: results.data });
  } catch (e) {
    return next(e);
  }
};

const createCaseForHandler = async (req, res, next) => {
  try {
    const results = await createCaseFor({
      account_id: req.user?.accountId,
      client_id: req.params?.user_id,
      start_date: req.body?.start_date,
      start_time: req.body?.start_time,
      counseling_type: req.body?.counseling_type,
      reason: req.body?.reason
    });

    return res.status(201).json({ message: "Case created." });
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
    
    return res.status(200).json({ counselors: results.data });
  } catch (e) {
    return next(e);
  }
};

module.exports = {
  createCounselingCaseSessionHandler,
  getCaseSessionsHandler,
  getCounselorCasesHandler,
  getVirtualRoomDataHandler,
  acceptCounselingRequestHandler,
  getCounselingRequestsHandler,
  getCounselingRequestHandler,
  terminateCounselorCaseSessionHandler,
  terminateCounselorCaseHandler,
  updateCounselorCaseHandler,
  updateCounselorCaseSessionHandler,
  activateVirtualRoomHandler,
  deactivateVirtualRoomHandler,
  getIntakeFormHandler,
  generateCaseReportHandler,
  getClientCaseRecordsHandler,
  getSeverityLevelsHandler,
  getClientsHandler,
  getReferralsHandler,
  getHandledReferrals,
  handleReferralHandler,
  closeReferralHandler,
  addCaseCollaboratorHandler,
  removeCaseCollaboratorHandler,
  getCaseCollaboratorsHandler,
  getCaseAnalyticsHandler,
  attachVirtualRoomToSessionHandler,
  getSessionAttachedVirtualRoomsHandler,
  removeAttachedVirtualRoomHandler,
  addSessionAttachmentHandler,
  removeSessionAttachmentHandler,
  getSessionAttachmentsHandler,
  getCounselingSchedulesHandler,
  createCaseForHandler,
  getCounselorsHandler
};
