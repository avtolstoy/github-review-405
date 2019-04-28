## What is this?

This is a pretty simple CLI tool to post comments from a pending GitHub PR review as standalone comments.

## Why?

If you are like me and just reviewed some PR, wrote a significant number of comments, hit 'Submit review' and all you got was `405 Not Allowed` no matter how many times you've retried, this tool is for you.

## Usage

### Options
```
Usage:
  node github-review-405 [OPTION]

Options:
  -h, --help            display this help
  -v, --version         show version
  -t, --token=TOKEN     GitHub token (can be also passed as GITHUB_TOKEN env variable)
  -r, --repo=REPO       GitHub repository (org/repo)
  -p, --pr=PR           GitHub Pull Request number
      --save[=SAVEFILE] Save comments into a file (defaults to org_repo_pr_reviewId.json, e.g. avtolstoy_test_123_123456.json). This option is enabled by default
      --load=LOADFILE   Load comments from a file instead of fetching from GitHub
```

### Examples

```console
$ GITHUB_TOKEN="<TOKEN>" github-review-405 -r avtolstoy/test-github-review-405 -p 1234
```

## License

This tool is licensed under the [BSD 2-Clause License](LICENSE).

## Author
[avtolstoy](https://github.com/avtolstoy)
