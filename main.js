/**
 * Copyright (c) Andrey Tolstoy <avtolstoy@gmail.com>
 * All rights reserved.
 *
 * This file is licensed under the BSD 2-Clause License, which accompanies this project
 * and is available under https://opensource.org/licenses/BSD-2-Clause.
 */

'use strict';

import { version as PROJECT_VERSION } from './package.json';
import { AppError } from './error.js';
import Getopt from 'node-getopt';
import Octokit from '@octokit/rest';
import OctokitPluginRetry from '@octokit/plugin-retry';
import OctokitPluginThrottling from '@octokit/plugin-throttling';
import fs from 'fs';
import util from 'util';
Octokit.plugin(OctokitPluginRetry);
Octokit.plugin(OctokitPluginThrottling);

const GITHUB_RATE_LIMIT_MAX_RETRIES = 5;
const GITHUB_ABUSE_LIMIT_MAX_RETRIES = 5;

const getopt = Getopt.create([
    ['h', 'help', 'display this help'],
    ['v', 'version', 'show version'],
    ['t', 'token=TOKEN', 'GitHub token (can be also passed as GITHUB_TOKEN env variable)'],
    ['r', 'repo=REPO', 'GitHub repository (org/repo)'],
    ['p', 'pr=PR', 'GitHub Pull Request number'],
    ['', 'save[=SAVEFILE]', 'Save comments into a file (defaults to org_repo_pr_reviewId.json, e.g. avtolstoy_test_123_123456.json). This option is enabled by default'],
    ['', 'load=LOADFILE', 'Load comments from a file instead of fetching from GitHub']
]).bindHelp();

async function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function timeoutNotify(message, timeout) {
    process.stdout.write(message + ' ');
    do {
        process.stdout.write(`${timeout}`);
        await sleep(250);
        process.stdout.write('.');
        await sleep(250);
        process.stdout.write('.');
        await sleep(250);
        process.stdout.write(' ');
        await sleep(250);
    } while (--timeout);
    console.log('');
}

async function saveComments(saveFile, comments) {
    try {
        console.log(`Saving comments into a file ${saveFile}`);
        await fs.promises.writeFile(saveFile, JSON.stringify(comments), 'utf-8');
        console.log('Saved');
    } catch (e) {
        throw new AppError('Failed to save comments into a file', e);
    }
}

export async function main() {
    const requiredArgs = ['repo', 'pr'];
    
    const opt = getopt.parseSystem();

    // Print version and exit
    if ('version' in opt.options) {
        console.info(PROJECT_VERSION);
        return;
    }

    // Check for required arguments
    if (!requiredArgs.every((v) => Object.keys(opt.options).includes(v))) {
        throw new AppError('No repository and PR number provided');
    }

    // Validate repo and PR
    if (opt.options.repo.indexOf('/') === -1 || isNaN(opt.options.pr)) {
        throw new AppError('No valid repository and PR number provided');
    }

    // Check for GitHub token
    const githubToken = opt.options.token || process.env.GITHUB_TOKEN;
    if (!githubToken || !githubToken.length) {
        throw new AppError('No GitHub token provided');
    }

    const [org, repo] = opt.options.repo.split('/');
    const pr = +opt.options.pr;
    
    const github = new Octokit({
        auth: githubToken,
        throttle: {
            onRateLimit: (retryAfter, options) => {
                console.warn(`Request quota exhausted for request ${options.method} ${options.url}`)

                if (options.request.retryCount < GITHUB_RATE_LIMIT_MAX_RETRIES) {
                    console.log(`Retrying after ${retryAfter} seconds`);
                    return true;
                }
            },
            onAbuseLimit: (retryAfter, options) => {
                console.warn(`Abuse detected for request ${options.method} ${options.url}`);
                if (options.request.retryCount < GITHUB_ABUSE_LIMIT_MAX_RETRIES) {
                    console.log(`Retrying after ${retryAfter} seconds`);
                    return true;
                }
            }
        }
    });

    // Get our userId
    console.log('Fetching user info');
    let userId;
    try {
        const auth = await github.users.getAuthenticated();
        userId = auth.data.id;
        console.log(`We are '${auth.data.login}' (${userId})`);
    } catch (e) {
        throw new AppError('Failed to fetch user info', e);
    }

    // Get the list of reviews for the PR and get the one in PENDING state
    console.log(`Fetching list of reviews for PR ${pr}`);
    let reviewId;
    try {
        const listReviewsReq = github.pulls.listReviews.endpoint.merge({
            owner: org,
            repo: repo,
            pull_number: pr
        });
        for await (const response of github.paginate.iterator(listReviewsReq)) {
            for (const review of response.data) {
                if (review.user.id === userId && review.state === 'PENDING') {
                    if (reviewId !== undefined) {
                        throw new AppError('More than one pending review?');
                    }
                    reviewId = review.id;
                }
            }
        }
    } catch (e) {
        throw new AppError(`Failed to fetch list of reviews for PR ${pr}`, e);
    }
    if (reviewId) {
        console.log(`Found a pending review from us: ${reviewId}`);
    }

    let saveFile = opt.options.save;
    if (!saveFile) {
        if (reviewId) {
            saveFile = `${org}_${repo}_${pr}_${reviewId}.json`;
        } else if (opt.options.load) {
            saveFile = opt.options.load;
        } else {
            saveFile = `${org}_${repo}_${pr}_sync.json`;
        }
    }
    let comments;
    if (reviewId && !('load' in opt.options)) {
        console.log(`Fetching a list of comments for the review ${reviewId}`);
        try {
            const getCommentsForReviewReq = github.pulls.getCommentsForReview.endpoint.merge({
                owner: org,
                repo: repo,
                pull_number: pr,
                review_id: reviewId
            });
            comments = await github.paginate(getCommentsForReviewReq) || [];
        } catch (e) {
            throw new AppError(`Failed to fetch a list of comments for the review ${reviewId}`, e);
        }

        // Save into a file
        await saveComments(saveFile, comments);
    } else if (opt.options.load) {
        console.log(`Loading comments from file '${opt.options.load}'`);
        try {
            const r = await fs.promises.readFile(opt.options.load);
            comments = JSON.parse(r);
        } catch (e) {
            throw new AppError(`Failed to load comments from file '${opt.options.load}'`);
        }
    } else {
        throw new AppError(`No pending review for PR ${pr} and no --load option specified`);
    }

    if (reviewId) {
        console.warn('The current pending review will be dismissed, removing all the pending comments');
        console.warn('This is a destructive but necessary action, because it is impossible to post comments on a PR with a pending review');
        console.warn('The comments have also been saved to a file and can be loaded from it, in case something goes wrong');
        await timeoutNotify(`Dismissing review ${reviewId} in`, 10);

        try {
            const rep = await github.pulls.deletePendingReview({
                owner: org,
                repo: repo,
                pull_number: pr,
                review_id: reviewId
            });
        } catch (e) {
            throw new AppError(`Failed to dismiss review ${reviewId}`, e);
        }
    }

    console.log(`Will be posting ${comments.length} pending review comments as regular comments`);
    for (const comment of comments) {
        if (!comment.new_id) {
            console.log(`Posting a comment for ${comment.commit_id.slice(0, 7)} ${comment.path}:${comment.position} (${comment.id})`);
        } else {
            // Comment has already been posted, skipping
            console.log(`Skipping an already posted comment for ${comment.commit_id.slice(0, 7)} ${comment.path}:${comment.position} (${comment.id})`);
            continue;
        }
        try {
            const pResp = await github.pulls.createComment({
                owner: org,
                repo: repo,
                pull_number: pr,
                body: comment.body,
                commit_id: comment.commit_id,
                path: comment.path,
                position: comment.position
            });
            console.log(`Posted, new id: ${pResp.data.id}`);

            comment.new_id = pResp.data.id;
        } catch (e) {
            console.warn('Failed:', e.message);
        }
    }

    // Re-save to keep track of already posted comments
    await saveComments(saveFile, comments);
}

export function showHelp() {
    getopt.showHelp();
}

export async function run() {
    try {
        await main();
    } catch (e) {
        if (e instanceof AppError) {
            console.error('Error:', e.message);
            if (!e.extra) {
                showHelp();
            } else {
                console.error(e.extra);
            }
        } else {
            console.error(e);
            console.error(e.stack);
        }
    
        process.exit(1);
    }
}

// Re-export
export { AppError };
