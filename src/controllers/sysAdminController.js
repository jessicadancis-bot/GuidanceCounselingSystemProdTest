//sysadmin
const fs = require("fs");
const pLimit = require("p-limit");
const {
  archiveAccount,
  getAccounts,
  updateAccount,
  getAccountData,
  disableAccount,
  batchRegisterAccounts,
  registerAccount,
  batchArchive,
  getAccountsAnalytics,
} = require("../services/accountServices");
const { getAuditLogs } = require("../services/auditService");
const {
  addCounselingQuestion,
  updateCounselingQuestion,
  archiveCounselingQuestion,
  getCounselingQuestions,
} = require("../services/counselingServices");
const {
  getCourses,
  createCourse,
  updateCourse,
  getCourseData,
  archiveCourse,
  createDepartment,
  getDepartments,
  updateDepartment,
  archiveDepartment,
} = require("../services/coursesServices");
const {
  getPermissions,
  getAccountPermissions,
  addRolePermission,
} = require("../services/permissionServices");
const { createRole, getRoles } = require("../services/roleService");
const { parseCSV } = require("../utils/csvHelper");
const { sendEmail } = require("../utils/emails");
const { ROLE } = require("../config/serverConstants");
const { backupDatabase } = require("../services/dbServices");
const { chunkArray } = require("../utils/ArrayHelper");

const createRoleHandler = async (req, res, next) => {
  try {
    const result = await createRole({
      role_name: req.body.name,
      role_description: req.body.description,
      role_permissions: req.body.permissions,
    });

    res.status(201).json({ message: `Role ${result.id} created!` });
  } catch (e) {
    return next(e);
  }
};

const getRolesHandler = async (req, res, next) => {
  try {
    const results = await getRoles({});

    const data = results?.data.map(({id, name, description}) => { return {id, name, description} });

    res.status(200).json({ roles: data });
  } catch (e) {
    return next(e);
  }
};

const getPermissionsHandler = async (req, res, next) => {
  try {
    const result = await getPermissions({});

    return res.status(200).json({ data: result.data });
  } catch (e) {
    return next(e);
  }
};

const getAccountPermissionsHandler = async (req, res, next) => {
  const { account_id } = req.query;

  try {
    const result = await getAccountPermissions({ account_id });

    return res.status(200).json({ data: result.data });
  } catch (e) {
    return next(e);
  }
};

const archiveAccountHandler = async (req, res, next) => {
  try {
    const results = await archiveAccount({
      performed_by: req.user?.accountId,
      account_id: req.params?.account_id,
      is_archived: req.body?.is_archived,
    });

    return res.status(204).json({
      message: `Account ${results.data?.public_id} has been archived`,
    });
  } catch (e) {
    return next(e);
  }
};

const disableAccountHandler = async (req, res, next) => {
  try {
    const results = await disableAccount({
      performed_by: req.user?.accountId,
      account_id: req.params?.account_id,
      is_disabled: req.body?.is_disabled,
    });

    return res.status(204).json({
      message: `Account ${results.data?.public_id} has been desabled`,
    });
  } catch (e) {
    return next(e);
  }
};

const addRolePermissionHandler = async (req, res, next) => {
  try {
    const { role_id, permission_id } = req.body;

    await addRolePermission({ role_id, permission_id });

    return res
      .status(201)
      .json({ message: "Permission added to role successfully!" });
  } catch (e) {
    return next(e);
  }
};

const getCoursesHandler = async (req, res, next) => {
  try {
    const results = await getCourses({
      search: req.query?.search,
      page: req.query?.page,
      department: (req.query?.department)?.split(','),
      is_archived: req.query?.is_archived,
      limit: req.query?.limit
    });

    return res.status(200).json({ courses: results.data, total_pages: results.total_pages, total: results.total });
  } catch (e) {
    return next(e);
  }
};

const getCourseDataHandler = async (req, res, next) => {
  try {
    const results = await getCourseData({
      course_code: req.params?.course_code,
    });

    return res.status(200).json({ course: results.data });
  } catch (e) {
    return next(e);
  }
};

const updateCourseHandler = async (req, res, next) => {
  try {
    const results = await updateCourse({
      new_department: req.body?.new_department,
      performed_by: req.user?.accountId,
      course_code: req.params?.course_code,
      new_course_name: req.body?.new_course_name,
      new_course_description: req.body?.new_course_description,
      new_total_years: req.body?.new_total_years,
    });

    return res.status(200).json({
      message: `Course Code ${results.data.course_code} has been updated.`,
    });
  } catch (e) {
    return next(e);
  }
};

const archiveCourseHandler = async (req, res, next) => {
  try {
    const results = await archiveCourse({
      is_archived: req.body?.is_archived,
      performed_by: req.user?.accountId,
      course_code: req.params?.course_code,
    });

    return res.status(200).json({
      message: `Course Code ${results.data.course_code} has been archived.`,
    });
  } catch (e) {
    return next(e);
  }
};

const getAccountsHandler = async (req, res, next) => {
  try {
    const results = await getAccounts({
      search: req.query?.search,
      roles: req.query?.roles,
      archived: req.query?.archived,
      limit: req.query?.limit,
      page: req.query?.page,
    });

    return res.status(200).json({ result: results.data, total_pages: results.total_pages, total: results.total });
  } catch (e) {
    return next(e);
  }
};

const getAccountDataHandler = async (req, res, next) => {
  try {
    const results = await getAccountData({
      public_id: req.params?.account_id,
    });

    return res.status(200).json({ account: results.data });
  } catch (e) {
    return next(e);
  }
};

const updateAccountHandler = async (req, res, next) => {
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
      role: req.body?.role,
    });

    return res
      .status(200)
      .json({ message: `Account ${results.data.public_id} have been update.` });
  } catch (e) {
    return next(e);
  }
};

const createCourseHandler = async (req, res, next) => {
  try {
    const results = await createCourse({
      department: req.body?.department,
      performed_by: req.user?.accountId,
      course_name: req.body.course_name,
      course_code: req.body.course_code,
      course_description: req.body.course_description,
      total_years: req.body.total_years,
    });

    return res.status(201).json({
      course: results.data,
    });
  } catch (e) {
    return next(e);
  }
};

const addCounselingQuestionHandler = async (req, res, next) => {
  try {
    const results = await addCounselingQuestion({
      question: req.body?.question,
      performed_by: req.user?.accountId,
    });

    return res.status(201).json({
      message: `question ${results.data.id} has been created with question ${results.data.question}`,
    });
  } catch (e) {
    return next(e);
  }
};

const updateCounselingQuestionHandler = async (req, res, next) => {
  try {
    const results = await updateCounselingQuestion({
      question_id: req.params?.question_id,
      new_question: req.body?.new_question,
      performed_by: req.user?.accountId,
    });

    return res.status(201).json({
      message: `question ${results.data.id} has been updated with question ${results.data.new_question}`,
    });
  } catch (e) {
    return next(e);
  }
};

const archiveCounselingQuestionHandler = async (req, res, next) => {
  try {
    const results = await archiveCounselingQuestion({
      is_archived: req.body?.is_archived,
      question_id: req.params?.question_id,
      performed_by: req.user?.accountId,
    });

    return res
      .status(201)
      .json({ message: `question ${results.data.id} has been archived` });
  } catch (e) {
    return next(e);
  }
};

const getCounselingQuestionsHandler = async (req, res, next) => {
  try {
    const results = await getCounselingQuestions({
      search: req.query?.search,
      page: req.query?.page,
      limit: req.query?.limit,
      is_archived: req.query?.is_archived,
    });

    return res.status(201).json({ questions: results.data, total_pages: results.total_pages, total: results.total });
  } catch (e) {
    return next(e);
  }
};

const getAuditLogsHandler = async (req, res, next) => {
  try {
    const results = await getAuditLogs({
      resource: [],
    });

    return res.status(200).json({ logs: results.data });
  } catch (e) {
    return next(e);
  }
};

const registerAccountHandler = async (req, res, next) => {
  try {
    const results = await registerAccount({
      performed_by: req.user?.accountId,
      email: req.body?.email,
      given_name: req.body?.given_name,
      middle_name: req.body?.middle_name,
      last_name: req.body?.last_name,
      student_id: req.body?.student_id,
      course: req.body?.course,
      year_level: req.body?.year_level,
      role: req.body?.role,
      birth_date: req.body?.birthdate,
      gender: req.body?.gender,
      department: req.body?.department
    });

    const email_body = `
        <p>Your account has been registered to CCTGuidanceSystem. Please use the following credentials to login</p>
        <p>Email: ${results.data.email}</p>
        <p>Password: ${results.data.password}</p>
      `;

    sendEmail(
      results?.data?.email,
      "CCT Guidance Account registration",
      email_body,
    ).catch((err) =>
      console.error(`Sending email to ${results.email} had failed`, err),
    );

    return res.status(201).json({ message: `Registration success.` });
  } catch (e) {
    return next(e);
  }
};

const batchRegisterAccountsHandler = async (req, res, next) => {
  try {
    const accounts = await parseCSV(req.file.path);

    const results = await batchRegisterAccounts({
      performed_by: req.user?.accountId,
      payload: accounts,
      batch_role: ROLE.CLIENT,
      batch_department: req.body?.department,
      batch_course: req.body.course,
    });

    await fs.promises.unlink(req.file.path);

    const acc_cred = results.inserted_cred || [];

    res.status(201).json({
      results: {
        success_total: results.success_total,
        failed_total: results.failed_total,
        success: results.success,
        failed: results.failed,
      },
    });

    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    const limit = pLimit(5);

    for (const chunk of chunkArray(acc_cred, 5)) {
      await Promise.all(
        chunk.map(({ email, password }) =>
          limit(async () => {
            const email_body = `
              <p>Your account has been registered to CCTGuidanceSystem. Please use the following credentials to login</p>
              <p>Email: ${email}</p>
              <p>Password: ${password}</p>
            `;
            try {
              await sendEmail(process.env.SMTP_USER || email, "CCT Guidance Account registration", email_body);
            } catch (err) {
              console.error(`Retrying: ${email}`, err);
              try {
                await sendEmail(process.env.SMTP_USER || email, "CCT Guidance Account registration", email_body);
              } catch (err2) {
                console.error(`Failed permanently: ${email}`, err2);
              }
            }
          })
        )
      );

      await delay(1000);
    }
  } catch (e) {
    return next(e);
  }
};

const batchArchiveAccountsHandler = async (req, res, next) => {
  try {
    const accounts = await parseCSV(req.file.path);

    const results = await batchArchive({
      performed_by: req.user?.accountId,
      payload: accounts,
    });

    await fs.promises.unlink(req.file.path);

    return res.status(201).json({
      archived: {
        total_archived: results.total_archived
      },
    });
  } catch (e) {
    return next(e);
  }
};

const createDepartmentHandler = async (req, res, next) => {
  try {
    const results = await createDepartment({
      name: req.body?.name,
      description: req.body?.description,
      performed_by: req.user?.accountId,
    });

    return res.status(201).json({ message: "Department created." });
  } catch (e) {
    return next(e);
  }
};

const updateDepartmentHandler = async (req, res, next) => {
  try {
    const results = await updateDepartment({
      department_id: req.params?.department_id,
      name: req.body?.new_name,
      description: req.body?.new_description,
      performed_by: req.user?.accountId,
    });

    return res.status(200).json({ message: "Department updated." });
  } catch (e) {
    return next(e);
  }
};

const archiveDepartmentHandler = async (req, res, next) => {
  try {
    const results = await archiveDepartment({
      department_id: req.params?.id,
      is_archived: req.body?.is_archived,
      performed_by: req.user?.accountId,
    });

    return res.status(200).json({ message: "Department archived." });
  } catch (e) {
    return next(e);
  }
};

const getDepartmentsHandler = async (req, res, next) => {
  try {
    const results = await getDepartments({
      search: req.query?.search,
      status: req.query?.status,
      page: req.query?.page,
      limit: req.query?.limit
    });

    return res.status(200).json({ departments: results.data, total_pages: results.total_pages, total: results.total });
  } catch (e) {
    return next(e);
  }
};

const backupDatabaseHandler = async (req, res, next) => {
  try {
    const results = await backupDatabase({});
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="backup_${Date.now()}.sql"`
    );
    res.setHeader("Content-Type", "application/sql");
    res.send(results.dump)
  } catch (e) {
    return next(e);
  }
};

const getAccountsAnalyticsHandler = async (req, res, next) => {
  try {
    const results = await getAccountsAnalytics({});

    return res.status(200).json({ analytics: results.data });
  } catch (e) {
    return next(e);
  }
};

module.exports = {
  createRoleHandler,
  getRolesHandler,
  getPermissionsHandler,
  getAccountPermissionsHandler,
  archiveAccountHandler,
  disableAccountHandler,
  addRolePermissionHandler,
  getCoursesHandler,
  createCourseHandler,
  getAccountsHandler,
  getAccountDataHandler,
  updateAccountHandler,
  updateCourseHandler,
  archiveCourseHandler,
  getCourseDataHandler,
  addCounselingQuestionHandler,
  updateCounselingQuestionHandler,
  archiveCounselingQuestionHandler,
  getCounselingQuestionsHandler,
  getAuditLogsHandler,
  batchRegisterAccountsHandler,
  registerAccountHandler,
  createDepartmentHandler,
  getDepartmentsHandler,
  updateDepartmentHandler,
  batchArchiveAccountsHandler,
  archiveDepartmentHandler,
  backupDatabaseHandler,
  getAccountsAnalyticsHandler
};
