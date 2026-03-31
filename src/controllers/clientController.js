const { REQUEST_TYPE } = require("../config/serverConstants");
const { requestCounseling, cancelCounselingRequest, getClientCounselingRequests, getCases } = require("../services/counselingServices");
const { getCourses } = require("../services/coursesServices");

const requestCounselingHandler = async (req, res, next) => {
  try {
    const result = await requestCounseling({
      account_id: req.user?.accountId,
      user_informations: req.body?.user_informations,
      counseling_type: req.body?.counseling_type,
      preferred_date: req.body?.preferred_date,
      preferred_time: req.body?.preferred_time,
      questionaire_answers: req.body?.questionaire_answers,
      type: "requested",
      request_type: REQUEST_TYPE.SELF_REQUEST
    });

    return res.status(201).json({
      message: `Schedule request created, Your reference id is: ${result.data.reference_id}`,
      request: result.data
    });
  } catch (e) {
    return next(e);
  }
};

const cancelCounselingRequestHandler = async (req, res, next) => {
  try {
    const results = await cancelCounselingRequest({ 
      reference_id: req.body?.reference_id,
      account_id: req.user?.accountId
    })

    return res.status(200).json({ message: "Request cancelled", canceled_data: results.data });
  } catch (e) {
    return next(e);
  }
}

const getClientCounselingRequestsHandler = async (req, res, next) => {
  try {
    const results = await getClientCounselingRequests({
      status: req.query?.status,
      client_id: req.user?.accountId
    });

    return res.status(200).json({ requests: results.data });
  } catch (e) {
    return next(e);
  }
};

const getClientCasesHandler = async (req, res, next) => {
  try {
    const results = await getCases({
      client_id: req.user?.accountId,
      status: req.query?.status
    });
    
    const data = results.data.map((c) => {return {
      case_id: c.case_id,
      session_id: c.session_id,
      counselor_name: c.counselor_name,
      next_meeting: c.next_meeting,
      next_meeting_end: c.next_meeting_end,
      request_reference_id: c.request_reference_id,
      status_id: c.status_id,
      status_name: c.status_name,
      room_id: c.room_id,
    }});

    return res.status(200).json({ cases: data });
  } catch (e) {
    return next(e);
  }
};

const getCoursesHandler = async (req, res, next) => {
  try {
    const results = await getCourses({
      is_archived: false,
    });

    return res.status(200).json({ courses: results.data });
  } catch (e) {
    return next(e);
  }
};

const counselingReferralHandler = async (req, res, next) => {
  try {
    const results = await counselingReferral({});

    return res.status(200).json({ message: "Referral success" });
  } catch (e) {
    return next(e);
  }
}

module.exports = {
  requestCounselingHandler,
  cancelCounselingRequestHandler,
  getClientCounselingRequestsHandler,
  getClientCasesHandler,
  getCoursesHandler
};