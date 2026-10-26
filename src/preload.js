const { contextBridge, ipcRenderer } = require('electron');

const calls = ['getProfile', 'uploadCv', 'saveProfile', 'saveKeys', 'refresh', 'listJobs', 'getJob', 'myJobs', 'stats', 'reviewQueue', 'markReviewed', 'undoReview', 'briefing', 'insights', 'setJobStage', 'setJobStatus', 'listAlerts', 'unreadAlerts',
  'readAlerts', 'listRecruiters', 'setRecruiterStatus', 'hiringTeamScript', 'addRecruiters', 'findCompanyContacts', 'openExternal'];

contextBridge.exposeInMainWorld('api', {
  ...Object.fromEntries(calls.map((c) => [c, (...a) => ipcRenderer.invoke(c, ...a)])),
  on: (ch, cb) => ['updated', 'refreshing', 'open-url', 'goto'].includes(ch) && ipcRenderer.on(ch, (_, d) => cb(d)),
});
