# Local CI (Windows + WSL)

Daily pull requests and the existing push branches run two compatibility jobs, using `self-hosted, Windows, X64, purge-ci` and `self-hosted, Linux, X64, purge-ci`. Fork PRs use hosted runners. Each job installs dependencies once and tests the latest reviewed official host. Windows also runs the existing installer, rollback and ACL smoke tests and reports Pending specs separately without changing the core test result.

## Register the WSL runner

1. Open Ubuntu in WSL2 and install the prerequisites: `sudo apt update && sudo apt install -y git curl unzip gh`.
2. In repository Settings → Actions → Runners → New self-hosted runner, choose Linux / x64. Follow the displayed download and extraction commands inside your Linux home directory (not /mnt/c).
3. Run the displayed configuration command as your regular Linux user, choosing a distinct name (e.g. AH-WSL) and the additional label `purge-ci`. Use the one-time token from GitHub; never store it in the repo.
4. If required, run `sudo ./bin/installdependencies.sh` in the runner directory. Run `./run.sh` to listen for jobs.

The independent Windows Local Compatibility and Pending specifications workflows remain manual. Both daily jobs reuse their local npm download cache. `PURGE_CI_TEST_CONCURRENCY` is optional; the default uses the available logical processors. The existing Release and runner smoke workflows are unchanged.

Release is manual on master only. Set `dry_run: true` to check the ZIP and checksums without creating or modifying a GitHub Release. Set false for the existing publish behavior. The runner uses the job's GITHUB_TOKEN, not a saved personal token.

Self-hosted runners need to be online for jobs to run. Run only trusted repository code on a personal machine. Do not trigger untrusted branches or fork PRs.
