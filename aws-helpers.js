const async = require('async');

module.exports = function (ec2, autoscaling) {
  /**
   * Returns ImageId of an AMI when AMI name is provided
   */
  function getAmiByName (name, callback) {
    const params = {
      Filters: [{
        Name: 'name',
        Values: [
          name
        ]
      }],
      Owners: ['self']
    };
    ec2.describeImages(params, (err, data) => {
      if (err) return callback(err);

      const ami = data.Images.find(image => image.Name === name);

      if (ami) {
        callback(null, ami.ImageId);
      } else {
        callback();
      }
    });
  }

  /**
   * updates launch config of given auto scaling group (initialConfig)
   * to with new AMI (amiName)
   */
  function updateLaunchConfig (initialConfig, amiName, callback) {
    const describeParams = {
      LaunchConfigurationNames: [ initialConfig.LaunchConfigurationName ]
    };
    autoscaling.describeLaunchConfigurations(describeParams, (err, data) => {
      if (err) return callback(err);
      const initialLaunchConfig = data.LaunchConfigurations[0];

      getAmiByName(amiName, (err, newImageId) => {
        if (err) return callback(err);
        if (!newImageId) return callback(new Error(`AMI not found: ${amiName}`));

        const newLaunchConfig = {
          IamInstanceProfile: initialLaunchConfig.IamInstanceProfile,
          ImageId: newImageId,
          InstanceType: initialLaunchConfig.InstanceType,
          LaunchConfigurationName: `${initialConfig.AutoScalingGroupName} - AMI ${amiName}`,
          SecurityGroups: initialLaunchConfig.SecurityGroups
        };
        autoscaling.createLaunchConfiguration(newLaunchConfig, (err, data) => {
          if (err && err.name !== 'AlreadyExists') {
            return callback(err);
          }

          callback(null, newLaunchConfig.LaunchConfigurationName);
        });
      });
    });
  }

  /**
   * Polls the auto scaling API till all scaling activity ceased
   * and invokes the callback.
   */
  function waitForScaling (autoScalingGroupName, options, callback) {
    const MAX_RETRIES = options.max_retries || 30;
    let count = 0;
    let interval = options.interval || 10000; // 10 seconds
    let ignoreTerminating = options.ignoreTerminating || false;

    let scaled = false;
    async.whilst(
      () => count < MAX_RETRIES && !scaled, // test condition
      (fn) => {
        count++;
        const params = {
          AutoScalingGroupNames: [
            autoScalingGroupName
          ]
        };

        setTimeout(() => {
          autoscaling.describeAutoScalingGroups(params, (err, data) => {
            if (err) return fn(err);
            const autoScalingGroup = data.AutoScalingGroups[0];

            console.log(JSON.stringify({
              state: 'waiting',
              count,
              autoScalingGroup: {
                Instances: autoScalingGroup.Instances,
                Capacity: autoScalingGroup.Instances.length,
                DesiredCapacity: autoScalingGroup.DesiredCapacity}
            }));

            if (ignoreTerminating) {
              scaled = autoScalingGroup
                .Instances
                .every(instance => !!instance.LifecycleState.match(/(InService|Terminating)/));
            } else {
              scaled = autoScalingGroup
                .Instances.every(instance => instance.LifecycleState === 'InService') &&
                autoScalingGroup.DesiredCapacity === autoScalingGroup.Instances.length;
            }
            fn();
          });
        }, interval);
      },
      (err, n) => {
        if (err) return callback(err);
        if (n === MAX_RETRIES) return callback(new Error('Timeout: Wait timed out'));
        callback();
      }
    );
  }

  /**
   * Removes old instances in the auto sacling group (autoScalingGroupName) and
   * only keeps instances with the (newLaunchConfig)
   */
  function removeOldInstances (autoScalingGroupName, newLaunchConfig, callback) {
    const params = {
      AutoScalingGroupNames: [
        autoScalingGroupName
      ]
    };

    autoscaling.describeAutoScalingGroups(params, (err, data) => {
      if (err) return callback(err);
      const InstancesForRemoval = data
            .AutoScalingGroups[0]
            .Instances.filter(instance => instance.LaunchConfigurationName !== newLaunchConfig);
      console.log(JSON.stringify({
        state: 'Instances to terminate',
        instances: InstancesForRemoval
      }));
      async.eachSeries(InstancesForRemoval, (instance, fn) => {
        console.log(JSON.stringify({
          state: 'terminating',
          instance
        }));

        const terminateParams = {
          InstanceId: instance.InstanceId,
          ShouldDecrementDesiredCapacity: false
        };
        autoscaling.terminateInstanceInAutoScalingGroup(terminateParams, (err) => {
          if (err) return fn(err);
          waitForScaling(autoScalingGroupName, {ignoreTerminating: true}, fn);
        });
      }, callback);
    });
  }

  return {
    getAmiByName,
    updateLaunchConfig,
    waitForScaling,
    removeOldInstances
  };
};
