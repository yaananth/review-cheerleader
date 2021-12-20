# Review cheerleader GitHub Action

![cheerios](https://user-images.githubusercontent.com/12280011/146829936-2190b1a5-cdde-4b36-b8ca-6fa6813cc97e.jpeg)

Pull request reviews are pivotal to teams. It helps to grow team.

The purpose of this my existence is to make it fun!

I would give cheerio coins to entice developers for more engaging reviews!

## How do I work

I grab all `closed/merged` pull requests and gets the review details.

I allot the following scores:

```js
const SCORE_CHANGES_REQUESTED = 1.5
const SCORE_COMMENTED = 1.5
const SCORE_APPROVED = 1.0
```

I encourage review discussions and hence the score is higher there!

In the end, I will send a message with report if you include the slack webhook URL.

## How to use me

Spin up a workflow with something like:

```yaml
on:
 workflow_dispatch:
 pull_request:
     types: [closed]

permissions:
  contents: read

jobs:
  cheers:
    # We want to avoid parallel runs, as we depend on artifacts produced by previous runs
    concurrency: review-cheerleader
    runs-on: ubuntu-latest
    name: 🎉
    steps:
    - name: Checkout
      uses: actions/checkout@v2
    - name: Review cheerleader
      id: cheerios-step
      uses: yaananth/review-cheerleader@v0.1
      with:
        api-token: ${{ secrets.API_TOKEN }}
        slack-webhook-url-map: "{'sample-team': '${{ secrets.SLACK_TOKEN }}'}"
    - name: Upload cheerios state
      uses: actions/upload-artifact@v2
      with:
        name: store
        path: ${{ steps.cheerios-step.outputs.cheerios-file }}
        retention-days: 1
```

### Is artifact needed?

Yes! That's how I store the state across runs, to make sure I don't process the same pull request again and again!

Store the file produced as `cheerios-file` output.

### What's slack-webhook-url-map?

I provide slack notifications for reviews done on behalf of a team.

So if a person `mona` reviewed on behalf of `mona-team`, you can set up notifications for reviews done for `mona-team` with: `{'mona-team': '${{ secrets.SLACK_TOKEN }}'}`

<img width="367" alt="CleanShot 2021-12-20 at 14 00 29@2x" src="https://user-images.githubusercontent.com/12280011/146818895-0a854ed4-f435-4141-926c-bb1e79a134b6.png">


### What secrets are needed?

- `API_TOKEN` (required): Since I use graphQL API, I need `read:discussion, read:org, repo` scopes, which don't exist in [`GITHUB_TOKEN`](https://docs.github.com/en/actions/security-guides/automatic-token-authentication), so I need this please!
- `SLACK_TOKEN` (optional, if you need slack notifications): Slack [incoming webhook URL](https://api.slack.com/messaging/webhooks) for a channel

### What if you don't need any slack requirement?

- I produce an output `cheerios-map` in the following format:

```js
{
    solo: {
        "$authorName:string": "$cheerioCoins:number"
        ...
    },
    team: {
        "$teamName:string": {
            "$authorName:string": "$cheerioCoins:number"
            ...
        }
        ...
    },
    additionalDetails: {
        "$teamName:string": {
            "approved": "$count:number",
            "requestedChanged": "$count:number",
            "commented": "$count:number",
            "delta": "$count:number",
            "PRs": [
                {
                    "title": "$title:string",
                    "url": "$url:string"
                }
                ...
            ]
        }
        ...
    }
}
```

you can `JSON.parse` the content and do anything you want with it!
