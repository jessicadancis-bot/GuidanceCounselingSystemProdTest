const { ROLE } = require("../config/serverConstants");
const { getAccounts, updateAccount } = require("../services/accountServices");
const { createAnnouncement, getAnnouncements, deleteAnnouncement } = require("../services/announcementServices");
const { getCounselingRequests, getCases } = require("../services/counselingServices");

const getCounselingCasesForMonitoringHandler = async (req, res, next) => {
  try {
    const results = await getCases({
      page: req.query?.page,
      status: req.query?.status,
      search: req.query?.search,
      limit: req.query?.limit || 1,
    });

    const data = results?.data?.map(({ counselor_name, case_id, client_name, counselor_id, client_id, created_at, updated_at, request_reference_id }) => 
      { return { counselor_name, case_id, client_name, counselor_id, client_id, created_at, updated_at, request_reference_id } }
    );

    return res.status(200).json({ cases: data, total: results.total, total_pages: results.total_pages });
  } catch (e) {
    return next(e);
  }
};

const getAccountsHandler = async (req, res, next) => {
  try {
    const results = await getAccounts({
      search: req.query?.search,
      sort_order: req.query?.sort_order,
      archived: req.query?.is_archived,
      page: req.query?.page,
      limit: req.query?.limit,
    });

    const data = results.data?.map(({ ...rest }) => rest);

    return res.status(200).json({ accounts: data, total_pages: results.total_pages });
  } catch (e) {
    return next(e);
  }
};

const updateAccountsHandler = async (req, res, next) => {
  try {
    const results = await updateAccount({
      performer_id: req.user?.accountId,
      account_id: req.params?.account_id,
      email: req.body?.email,
      department: req.body?.department,
      course: req.body?.course,
      year_level: req.body?.year_level,
      public_id: req.body.public_id,
      given_name: req.body.given_name,
      middle_name: req.body.middle_name,
      last_name: req.body.last_name,
    });

    return res.status(200).json({ counselors: results.data });
  } catch (e) {
    return next(e);
  }
};

const getCounselingRequestHandler = async (req, res, next) => {
  try {
    const response = await getCounselingRequests({
      search: req.query?.search,
      limit: req.query?.limit,
      page: req.query.page,
      status: req.query.status,
    });

    return res.status(200).json({ requests: response.data, total_pages: response.total_pages });
  } catch (e) {
    return next(e);
  }
};

const createAnnouncementHandler = async (req, res, next) => {
  try {
    const results = await createAnnouncement({
      title: req.body?.title,
      content: req.body?.content,
      audience: req.body?.audience
    });

    return res.status(201).json({ message: "Announcement created" });
  } catch (e) {
    return next(e);
  }
};

const getAnnouncementHandler = async (req, res, next) => {
  try {
    const results = await getAnnouncements({
      limit: req.query?.limit || 1,
      page: req.query?.page,
    });

    return res.status(200).json({ announcements: results.data, total_pages: results.total_pages });
  } catch (e) {
    return next(e);
  }
};

const deleteAnnouncementHandler = async (req, res, next) => {
  try {
    const results = await deleteAnnouncement({
      id: req.params.id
    });

    return res.status(200).json({ message: "Announcement deleted" });
  } catch (e) {
    return next(e);
  }
};

module.exports = {
  getCounselingCasesForMonitoringHandler,
  getAccountsHandler,
  getCounselingRequestHandler,
  updateAccountsHandler,
  createAnnouncementHandler,
  getAnnouncementHandler,
  deleteAnnouncementHandler
}