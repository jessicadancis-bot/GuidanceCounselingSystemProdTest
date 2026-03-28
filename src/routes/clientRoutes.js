const express = require("express");
const { requiresPermission } = require("../middleware/authMiddleware");
const { PERMISSIONS } = require("../config/permissionsConfig");
const {
  requestCounselingHandler,
  cancelCounselingRequestHandler,
  getClientCasesHandler,
  getClientCounselingRequestsHandler,
} = require("../controllers/clientController");
const multer = require("multer");

const recording_storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const account_id = req.user?.accountId;
    const session_id = req.body.session_id;
    const folder = path.join(
      __dirname,
      "..",
      "recordings",
      account_id,
      session_id,
    );
    fs.mkdirSync(folder, { recursive: true });
    cb(null, folder);
  },
  filename: (req, file, cb) => {
    cb(null, `chunk_${Date.now()}.webm`);
  },
});

const recording_upload = multer({ storage: recording_storage });

const router = express.Router();

router.post(
  "/session/:id/recording/upload",
  requiresPermission({}),
  recording_upload.single("file"),
  async (req, res, next) => {
    try {
      const session_id = req.params?.id;
      const file_path = req.file.path;

      await pool.query(
        `
        UPDATE session_rooms AS s
        JOIN counseling_cases AS cc ON cc.case_id = s.case_id
        JOIN counseling_requests AS cr ON cr.reference_id = cc.request_reference_id
        SET recording_path = ?
        WHERE session_id = ?`,
        [file_path, session_id],
      );

      res.status(200).json({ saved: true, path: file_path });
    } catch (e) {
      next(e);
    }
  },
);
router.get(
  "/counseling/cases",
  requiresPermission({ permission: [PERMISSIONS.GET_APPOINTMENT_CASE] }),
  getClientCasesHandler,
);
router.get(
  "/counseling/request",
  requiresPermission({ permission: [PERMISSIONS.GET_SELF_REQUEST] }),
  getClientCounselingRequestsHandler,
);
router.post(
  "/counseling/request",
  requiresPermission({ permission: [PERMISSIONS.REQUEST_COUNSELING] }),
  requestCounselingHandler,
);
router.patch(
  "/counseling/request/cancel",
  requiresPermission({ permission: [PERMISSIONS.REQUEST_COUNSELING] }),
  cancelCounselingRequestHandler,
);

module.exports = router;
