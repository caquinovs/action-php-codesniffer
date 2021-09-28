import { lint } from 'php-codesniffer';
import { blame } from 'git-blame-json';
import * as path from 'path';
import * as core from '@actions/core';
import * as github from '@actions/github';
import * as Webhooks from '@octokit/webhooks';

export async function runOnBlame(files: string[]): Promise<void> {
  try {
    const options: Record<string, string> = {};
    const standard = core.getInput('standard');
    if (standard) options.standard = standard;

    const lintResults = await lint(
      files,
      core.getInput('phpcs_path', { required: true }),
      options
    );

    console.log(lintResults);

    const dontFailOnWarning =
      core.getInput('fail_on_warnings') == 'false' ||
      core.getInput('fail_on_warnings') === 'off';
    if (!lintResults.totals.errors) {
      if (dontFailOnWarning) {
        console.log(
          `The fail_on_warnings option has been set to ${dontFailOnWarning}`
        );
        return;
      }
      if (!lintResults.totals.warnings) {
        console.log('There are no warnings from phpcs');
        return;
      }
    }

    // blame files and output relevant errors
    const payload = github.context
      .payload as Webhooks.WebhookPayloadPullRequest;

    const blameOptions: Record<string, string> = {
      rev: `${payload.pull_request.base.sha}..`,
    };

    for (const [file, results] of Object.entries(lintResults.files)) {
      const blameMap = await blame(file, blameOptions);
      console.log(blameMap);
      let headerPrinted = false;
      for (const message of results.messages) {
        if (
          !blameMap
            .get(message.line)
            ?.hash.startsWith(payload.pull_request.base.sha)
        ) {
          // that's our line
          // we simulate checkstyle output to be picked up by problem matcher
          if (!headerPrinted) {
            console.log(`<file name="${path.relative(process.cwd(), file)}">`);
            headerPrinted = true;
          }
          // output the problem
          console.log(
            '<error line="%d" column="%d" severity="%s" message="%s" source="%s"/>',
            message.line,
            message.column,
            message.type.toLowerCase(),
            message.message,
            message.source
          );
          // fail
          if (message.type === 'WARNING' && !dontFailOnWarning)
            core.setFailed(message.message);
          else if (message.type === 'ERROR') core.setFailed(message.message);
        } else {
          // output the lines that were skipped over, to make future debugging easier
          // the lines are prepended with debug so that the problem matcher
          // will not pick these up and turn them into annotations
          core.debug(`<file name="${path.relative(process.cwd(), file)}">`);
          core.debug(
            `<error line="${message.line}" column="${
              message.column
            }" severity="${message.type.toLowerCase()}" message="${
              message.message
            }" source="${message.source}"/>`
          );
        }
      }
    }
  } catch (err) {
    core.debug(err);
    core.setFailed(err);
  }
}
