#!/usr/bin/env node

const argv = require('minimist')(process.argv.slice(2));
const async = require('async');
const AWS = require('aws-sdk');
const ec2 = new AWS.EC2({region: argv.region});
const autoscaling = new AWS.AutoScaling({region: argv.region});

const awsHelpers = require('./aws-helpers')(ec2, autoscaling);

const AUTOSCALING_GROUP_NAME = argv.group;
const AMI_NAME = argv.ami;

let initialConfig = {};
let newLaunchConfigName = '';

async.series([function getInitialState (fn) {
  const params = {
    AutoScalingGroupNames: [
      AUTOSCALING_GROUP_NAME
    ]
  };
  autoscaling.describeAutoScalingGroups(params, (err, data) => {
    if (err) return fn(err);

    initialConfig = data.AutoScalingGroups[0];
    console.log(JSON.stringify(initialConfig, null, 2));
    fn();
  });
}, function updateLaunchConfig (fn) {
  awsHelpers.updateLaunchConfig(initialConfig, AMI_NAME, (err, launchConfigName) => {
    if (err) return fn(err);
    newLaunchConfigName = launchConfigName;
    fn();
  });
}, function updateAutscalingGroup (fn) {
  const params = {
    AutoScalingGroupName: AUTOSCALING_GROUP_NAME,
    LaunchConfigurationName: newLaunchConfigName,
    MinSize: initialConfig.MinSize + 1,
    MaxSize: initialConfig.MaxSize + 1,
    DesiredCapacity: initialConfig.DesiredCapacity + 1
  };
  autoscaling.updateAutoScalingGroup(params, (err, data) => {
    if (err) return fn(err);
    fn();
  });
}, function waitForScaling (fn) {
  awsHelpers.waitForScaling(AUTOSCALING_GROUP_NAME, {}, fn);
}, function removeOldInstances (fn) {
  console.log(JSON.stringify({ state: 'remove old instances' }));
  awsHelpers.removeOldInstances(
    AUTOSCALING_GROUP_NAME,
    newLaunchConfigName,
    fn
  );
}, function setIntialSizing (fn) {
  const params = {
    AutoScalingGroupName: AUTOSCALING_GROUP_NAME,
    MinSize: initialConfig.MinSize,
    MaxSize: initialConfig.MaxSize,
    DesiredCapacity: initialConfig.DesiredCapacity
  };
  autoscaling.updateAutoScalingGroup(params, (err, data) => {
    if (err) return fn(err);
    fn();
  });
}], (err) => {
  if (err) throw err;
});
