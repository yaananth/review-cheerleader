"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.unzip = void 0;
const core = __importStar(require("@actions/core"));
const github_1 = require("@actions/github");
const adm_zip_1 = __importDefault(require("adm-zip"));
const path_1 = require("path");
const fs = __importStar(require("fs"));
const axios = __importStar(require("axios"));
const SCORE_CHANGES_REQUESTED = 1.5;
const SCORE_COMMENTED = 1.5;
const SCORE_APPROVED = 1.0;
const artifactDownloadPath = "cheerios-artifacts";
const storeFileName = "cheerios-state.json";
const PRsOutputLimit = 10;
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        const apiToken = core.getInput("api-token");
        const slackHeadingEmoji = core.getInput("slack-heading-emoji");
        const slackCheerioEmoji = core.getInput("slack-cheerio-emoji");
        const slackWebHookMap = JSON.parse((core.getInput("slack-webhook-url-map") || "").replace(/'/g, '"'));
        const repoOctokit = (0, github_1.getOctokit)(apiToken);
        const pageSize = 100;
        const state = yield getStoredState(repoOctokit);
        let pullsResult;
        let outputTeamToAuthorText = {};
        let cursor = state.lastPRCursor;
        try {
            do {
                core.info(`🕵 Searching for PR's for ${github_1.context.repo.owner}/${github_1.context.repo.repo} cursor: ${cursor}...`);
                const graphQLQuery = `query {
                repository(owner: "${github_1.context.repo.owner}", name: "${github_1.context.repo.repo}") {
                    pullRequests(first: ${pageSize}, states: [MERGED, CLOSED] ${cursor ? `, after: "${cursor}"` : ""}) {
                        pageInfo {
                            hasNextPage
                            endCursor
                        }
                        nodes {
                            id
                            url
                            title
                            reviews(last: 50, states: [COMMENTED, APPROVED, CHANGES_REQUESTED]) {
                              nodes {
                                id
                                state
                                createdAt
                                author {
                                  login
                                }
                                onBehalfOf(last: 10) {
                                  nodes {
                                    name
                                  }
                                }
                              }
                            }
                        }
                    }
                }
            }`;
                core.info(`ℹ️ Executing graphQL query: ${graphQLQuery}`);
                // search pull requests by graphql
                pullsResult = yield repoOctokit.graphql(graphQLQuery);
                core.info(`ℹ️ Result: ${JSON.stringify(pullsResult)}`);
                cursor = pullsResult.repository.pullRequests.pageInfo.endCursor;
                core.info(`📋 Found ${pullsResult.repository.pullRequests.nodes.length} PR's for ${github_1.context.repo.owner}/${github_1.context.repo.repo}, cursor: ${cursor}`);
                // iterate over PR's
                for (const pull of pullsResult.repository.pullRequests.nodes) {
                    core.info(`📋 Found PR #${pull.url}`);
                    // check if PR has been reviewed
                    if (pull.reviews.nodes.length === 0) {
                        core.info(`⏯️ PR has not been reviewed yet, skipping`);
                        continue;
                    }
                    else {
                        core.info(`✔️ PR #${pull.url} has been reviewed`);
                        // loop through reviews
                        for (const review of pull.reviews.nodes) {
                            // we only care about reviews from the team
                            const author = review.author.login;
                            if (review.onBehalfOf.nodes.length === 0) {
                                core.info(`✅ Review #${review.id} by ${author} is not on behalf of the team`);
                                if (!state.cheeriosSoloMap[author]) {
                                    state.cheeriosSoloMap[author] = 0;
                                }
                                if (review.state === "CHANGES_REQUESTED") {
                                    core.info(`☑️ ${author} reviewed with changes requested, so gets score of ${SCORE_CHANGES_REQUESTED}`);
                                    state.cheeriosSoloMap[author] += SCORE_CHANGES_REQUESTED;
                                }
                                if (review.state === "APPROVED") {
                                    core.info(`☑️ ${author} reviewed with approved, so gets score of ${SCORE_APPROVED}`);
                                    state.cheeriosSoloMap[author] += SCORE_APPROVED;
                                }
                                if (review.state === "COMMENTED") {
                                    core.info(`☑️ ${author} reviewed left comments, so gets score of ${SCORE_COMMENTED}`);
                                    state.cheeriosSoloMap[author] += SCORE_COMMENTED;
                                }
                                continue;
                            }
                            const teamName = review.onBehalfOf.nodes[0].name;
                            if (!state.cheeriosTeamMap[teamName]) {
                                state.cheeriosTeamMap[teamName] = {};
                            }
                            if (!outputTeamToAuthorText[teamName]) {
                                outputTeamToAuthorText[teamName] = {};
                            }
                            if (!state.cheeriosTeamMap[teamName][author]) {
                                state.cheeriosTeamMap[teamName][author] = 0;
                            }
                            if (!outputTeamToAuthorText[teamName][author]) {
                                outputTeamToAuthorText[teamName][author] = {
                                    approved: 0,
                                    requestedChanged: 0,
                                    commented: 0,
                                    delta: 0,
                                    PRs: [],
                                };
                            }
                            core.info(`✅ Review was done on behalf of team ${review.onBehalfOf.nodes[0].name}`);
                            let considerPR = false;
                            if (review.state === "CHANGES_REQUESTED") {
                                core.info(`☑️ ${author} reviewed with changes requested, so gets score of ${SCORE_CHANGES_REQUESTED}`);
                                state.cheeriosTeamMap[teamName][author] += SCORE_CHANGES_REQUESTED;
                                outputTeamToAuthorText[teamName][author].requestedChanged += 1;
                                outputTeamToAuthorText[teamName][author].delta += SCORE_CHANGES_REQUESTED;
                                considerPR = true;
                            }
                            if (review.state === "APPROVED") {
                                core.info(`☑️ ${author} reviewed with approved, so gets score of ${SCORE_APPROVED}`);
                                state.cheeriosTeamMap[teamName][author] += SCORE_APPROVED;
                                outputTeamToAuthorText[teamName][author].approved += 1;
                                outputTeamToAuthorText[teamName][author].delta += SCORE_APPROVED;
                                considerPR = true;
                            }
                            if (review.state === "COMMENTED") {
                                core.info(`☑️ ${author} reviewed left comments, so gets score of ${SCORE_COMMENTED}`);
                                state.cheeriosTeamMap[teamName][author] += SCORE_COMMENTED;
                                outputTeamToAuthorText[teamName][author].commented += 1;
                                outputTeamToAuthorText[teamName][author].delta += SCORE_COMMENTED;
                                considerPR = true;
                            }
                            if (considerPR) {
                                outputTeamToAuthorText[teamName][author].PRs.push({
                                    title: pull.title,
                                    url: pull.url,
                                });
                            }
                        }
                    }
                }
            } while (pullsResult.repository.pullRequests.nodes.length === pageSize);
        }
        catch (error) {
            core.info(`Got error while parsing pr's ${error}, ignoring and proceeding...`);
        }
        state.lastPRCursor = cursor ? cursor : state.lastPRCursor;
        state.additionalDetails = outputTeamToAuthorText;
        core.info(`📋 Storing state for the next run, also setting output "cheerios-map": ${JSON.stringify(state)}`);
        // set output
        core.setOutput("cheerios-map", JSON.stringify({
            solo: state.cheeriosSoloMap,
            team: state.cheeriosTeamMap,
            additionalDetails: state.additionalDetails,
        }));
        // send results, TODO: only send new ones??
        core.info(`📋 Slack webhook map: ${JSON.stringify(slackWebHookMap)}`);
        const teamNamesArray = Object.keys(slackWebHookMap);
        if (Object.keys(slackWebHookMap).length > 0 &&
            Object.keys(state.additionalDetails).length > 0) {
            core.info(`📩 Sending results to slack...`);
            for (const teamNameIndex in teamNamesArray) {
                const teamName = teamNamesArray[teamNameIndex];
                const slackWebHook = slackWebHookMap[teamName];
                core.info(`📩 Processing for team ${teamName}...`);
                if (state.additionalDetails[teamName]) {
                    core.info(`📩 Sending results for team ${teamName} to slack...`);
                    let message = slackHeadingEmoji +
                        ` *I am your review cheer leader! I have an update for you!*`;
                    message += `\n\n`;
                    let authorsArray = [];
                    let cheeriosArray = [];
                    for (const author in state.additionalDetails[teamName]) {
                        const authorStats = state.additionalDetails[teamName][author];
                        message += `*<@${author}>* is up by ${authorStats.delta} cheerios!\n`;
                        authorsArray.push(author);
                        cheeriosArray.push(state.cheeriosTeamMap[teamName][author]);
                        if (authorStats.PRs.length > 0) {
                            message += `🕵 I considered the following ${authorStats.PRs.length} pull requests:\n`;
                            for (const PR of authorStats.PRs.slice(0, PRsOutputLimit)) {
                                // slack link
                                message += `- <${PR.url}|${PR.title}>\n`;
                            }
                            if (authorStats.PRs.length > PRsOutputLimit) {
                                message += `- and more!\n`;
                            }
                        }
                    }
                    // add leaderboard details to message
                    message += `🏆 ${slackCheerioEmoji} Cheerboard\n`;
                    const sortedCheerios = cheeriosArray.slice(0).sort((a, b) => b - a);
                    // loop through sorted array and add to message
                    for (const cheerioIndex in sortedCheerios) {
                        const cheerio = sortedCheerios[cheerioIndex];
                        const author = authorsArray[cheeriosArray.indexOf(cheerio)];
                        message += `- *<@${author}>* has ${cheerio} cheerios\n`;
                    }
                    yield sendSlackMessage(slackWebHook, message);
                }
            }
        }
        createStateToStore(state);
    });
}
function sendSlackMessage(slackWebHook, message) {
    return __awaiter(this, void 0, void 0, function* () {
        const payload = {
            text: message,
        };
        yield axios.default.post(slackWebHook, payload);
    });
}
function getStoredState(octokit) {
    return __awaiter(this, void 0, void 0, function* () {
        let store = {
            lastPRCursor: "",
        };
        // get last known run and it's artifact
        core.info(`Getting last workflow  ${github_1.context.workflow} run...`);
        // get workflow using the workflow name
        const lastRun = yield octokit.actions.listWorkflowRunsForRepo({
            owner: github_1.context.repo.owner,
            repo: github_1.context.repo.repo,
            per_page: 1,
            workflow_id: github_1.context.workflow,
            status: "success",
        });
        if (lastRun.data.total_count > 0) {
            const workflowRun = lastRun.data.workflow_runs[0];
            const workflowCompletedAt = workflowRun.updated_at;
            // check if completed at is with in 5 minutes
            const lastRunCompletedAt = new Date(workflowCompletedAt);
            const now = new Date();
            const diff = now.getTime() - lastRunCompletedAt.getTime();
            core.info(`Found ${lastRun.data.total_count}, completed at ${workflowCompletedAt} (${diff} ms ago) with URL: ${lastRun.data.workflow_runs[0].html_url}`);
            if (diff < 1 * 60 * 1000) {
                // wait until 1 minutes after last run
                const leftOver = 1 * 60 * 1000 - diff;
                core.info(`Last run completed at ${lastRunCompletedAt} is within 1 minutes, waiting ${leftOver} ms, this is make sure artifact is read with full contents...`);
                yield new Promise((resolve) => setTimeout(resolve, leftOver));
            }
            core.info(`Getting artifact from last run ${workflowRun.id}...`);
            const lastRunArtifact = yield octokit.actions.listArtifactsForRepo({
                owner: github_1.context.repo.owner,
                repo: github_1.context.repo.repo,
                run_id: lastRun.data.workflow_runs[0].id,
                per_page: 1,
            });
            if (lastRunArtifact.data.total_count > 0) {
                try {
                    const artifact = lastRunArtifact.data.artifacts[0];
                    core.info(`Found artifact ${artifact.name} with id ${artifact.id} for last run ${lastRun.data.workflow_runs[0].html_url}`);
                    // download artifact from github
                    const artifactResponse = yield octokit.actions.downloadArtifact({
                        owner: github_1.context.repo.owner,
                        repo: github_1.context.repo.repo,
                        artifact_id: artifact.id,
                        archive_format: "zip",
                    });
                    const zip = yield artifactResponse.data;
                    core.info(`Artifact ${artifact.name} was successfuly downloaded`);
                    (0, exports.unzip)(zip, artifactDownloadPath);
                    core.info(`Artifact ${artifact.name} was successfuly extracted`);
                    const storeFile = (0, path_1.resolve)(artifactDownloadPath, storeFileName);
                    core.info(`Reading ${storeFileName} file from ${storeFile}`);
                    const storeFileContent = fs.readFileSync(storeFile, "utf8");
                    core.info(`Content ${storeFileContent}...`);
                    store = JSON.parse(storeFileContent);
                    core.info(`Read ${storeFileName} file from ${storeFile}, last page cursor: ${store.lastPRCursor}`);
                }
                catch (error) {
                    core.info(`Got error while getting previous run artifact ${error}, ignoring and proceeding...`);
                }
            }
            else {
                core.info(`Found no artifacts for last run ${lastRun.data.workflow_runs[0].id}`);
            }
        }
        else {
            core.info(`Didn't find any last runs...`);
        }
        return {
            lastPRCursor: store.lastPRCursor || "",
            cheeriosTeamMap: store.cheeriosTeamMap || {},
            cheeriosSoloMap: store.cheeriosSoloMap || {},
            additionalDetails: store.additionalDetails || {},
        };
    });
}
function createStateToStore(state) {
    return __awaiter(this, void 0, void 0, function* () {
        const storeFile = (0, path_1.resolve)(artifactDownloadPath, storeFileName);
        core.setOutput("cheerios-file", storeFile);
        core.info(`Creating ${storeFile}`);
        // create store directory
        if (!fs.existsSync(artifactDownloadPath)) {
            fs.mkdirSync(artifactDownloadPath);
        }
        fs.writeFileSync(storeFile, JSON.stringify(state, null, 2));
    });
}
const unzip = (archive, path) => {
    const zip = new adm_zip_1.default(Buffer.from(archive));
    zip.getEntries().forEach((entry) => {
        console.log("Extract: ", (0, path_1.resolve)(path, entry.entryName));
    });
    zip.extractAllTo((0, path_1.resolve)(path), true);
};
exports.unzip = unzip;
run();
