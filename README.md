# A-Roller

The `roller` script takes a `AMI name` as a parameter and performs a rolling
update on the selected auto scaling group.

First the auto scaling group will be updated to use the new AMI and its
`MinSize`, `MaxSize` and `DesiredCapacity` values are increase by 1. Once
scaled out, `roller` terminates the remaining instances with the old launch
configuration and waits that a new instance with the new launch configruation
gets ready. This step will be repeated till all old instances are terminated.
Finally the auto scaling capacity will be set to its original state.

## Installation

``` bash
npm install -g a-roller
```

## Usage

``` bash
roller --region aws-region --group "Auto scaling group name" --ami "AMI name"
```
