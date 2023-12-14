import { RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import { ManagedPolicy, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Cluster, Compatibility, ContainerImage, FargateService, LogDriver, NetworkMode, TaskDefinition } from "aws-cdk-lib/aws-ecs";
import { Peer, Port, SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";
import { Protocol } from "aws-cdk-lib/aws-ecs";
import { LifecyclePolicy, PerformanceMode, ThroughputMode, FileSystem, AccessPoint, } from "aws-cdk-lib/aws-efs";
import { LogGroup } from "aws-cdk-lib/aws-logs";

export function createFargate(stack: Construct) {

  const { deploymentType } = process.env;

  const logGroup = new LogGroup(stack, "mc-server-log-group", {
    logGroupName:`/ecs/${deploymentType}-mc-Server`,
    removalPolicy:RemovalPolicy.DESTROY,
  })

  const vpc = Vpc.fromLookup(stack, "vpc", {
    vpcName:"mc-ecs-fargate-server-vpc",
  });

  const fargatemcServerRoleName =  "mc-server-ecs-task-role"
  const fargatemcServerRole = new Role(stack, "mc-server-ecs-task-role", {
    assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
    managedPolicies: [
      ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AmazonECSTaskExecutionRolePolicy"
      ),
    ],
    roleName:`${deploymentType}-${fargatemcServerRoleName}`,
  });

  const efsSecurityGroupName = "mc-server-efs-security-group"
  const efsSG = new SecurityGroup(stack, efsSecurityGroupName, {
    vpc,
    allowAllOutbound: true,
    securityGroupName: `${deploymentType}-${efsSecurityGroupName}`,
  });

  const ec2EFSMaintenanceSecurityGroupName = "mc-server-efs-ec2-maintenance-security-group"
  const ec2EFSMaintenanceSecurityGroup = new SecurityGroup(stack, ec2EFSMaintenanceSecurityGroupName, {
    vpc,
    allowAllOutbound: true,
    securityGroupName: `${deploymentType}-${ec2EFSMaintenanceSecurityGroupName}`,
  });
   // EFS connection from EC2 for managing the data
   efsSG.addIngressRule(
    Peer.securityGroupId(ec2EFSMaintenanceSecurityGroup.securityGroupId),
    Port.allTcp(),
    "Allow EC2 access for managing data",
  );

  // Create the file system
  const mcDataEFS = new FileSystem(stack, "mc-server-efs", {
    vpc,
    lifecyclePolicy: LifecyclePolicy.AFTER_14_DAYS,
    performanceMode: PerformanceMode.GENERAL_PURPOSE,
    throughputMode: ThroughputMode.BURSTING,
    removalPolicy: RemovalPolicy.DESTROY,
    securityGroup:efsSG,
    fileSystemName:`${deploymentType}-mc-server-efs`,
    allowAnonymousAccess:true,
  });

  const mcDataEFSAccessPoint = new AccessPoint(stack, "mc-server-efs-access-point",  {
    fileSystem: mcDataEFS,
    path: "/",
    createAcl: {
     ownerGid: "1000",
     ownerUid: "1000",
     permissions: "777"
    },
    posixUser: {
     uid: "1000",
     gid: "1000",
    }
 })

  /**
   * | CPU Value | Memory Value                                    | Operating Systems Supported for AWS Fargate |
   * |-----------|-------------------------------------------------|---------------------------------------------|
   * | 256       | 512 MiB, 1 GB, 2 GB                             | Linux                                       |
   * | 512       | 1 GB, 2 GB, 3 GB, 4 GB                          | Linux                                       |
   * | 1024      | 2 GB, 3 GB, 4 GB, 5 GB, 6 GB, 7 GB, 8 GB        | Linux, Windows                              |
   * | 2048      | Between 4 GB and 16 GB in 1 GB increments       | Linux, Windows                              |
   * | 4096      | Between 8 GB and 30 GB in 1 GB increments       | Linux, Windows                              |
   * | 8192      | Between 16 GB and 60 GB in 4 GB increments      | Linux                                       |
   * | 16384     | Between 32 GB and 120 GB in 8 GB increments     | Linux                                       |
   */

  const taskVolumeName = `${deploymentType}-mc-server-task-volume`;
  const taskDefinition = new TaskDefinition(stack, "mc-task-definition", {
    compatibility: Compatibility.FARGATE,
    cpu: "2048",
    memoryMiB: "4096",
    networkMode: NetworkMode.AWS_VPC,
    taskRole: fargatemcServerRole,
    volumes:[
      {
        name: taskVolumeName,
        efsVolumeConfiguration: {
          rootDirectory:"/",
          fileSystemId: mcDataEFS.fileSystemId,
        },
      }
    ],
  });

  const container = taskDefinition.addContainer("mc-container", {
    containerName:`${deploymentType}-mc-server-container`,
    image: ContainerImage.fromRegistry("marctv/minecraft-papermc-server:latest"),
    logging: LogDriver.awsLogs({
      streamPrefix: "mc-server-logs",
      logGroup: logGroup,
    }),
  });
// The following port mappings are for java edition.
  container.addPortMappings({name:"mc-udp-mapping", containerPort: 25565, protocol:Protocol.UDP, hostPort:25565 });
  container.addPortMappings({name:"mc-tcp-mapping", containerPort: 25565, protocol:Protocol.TCP, hostPort:25565 });
  // The following port mappings are for bedrock edition. 
  container.addPortMappings({name:"geyser-udp-mapping", containerPort: 19132, protocol:Protocol.UDP, hostPort:19132 });
  container.addPortMappings({name:"geyser-tcp-mapping", containerPort: 19132, protocol:Protocol.TCP, hostPort:19132 });

  container.addMountPoints({
    containerPath: '/mc',
    sourceVolume: taskVolumeName,
    readOnly: false,
  });


  const ecsSG = new SecurityGroup(stack, "mc-ecs-security-group", {
    vpc,
    allowAllOutbound: true,
    securityGroupName:`${deploymentType}-mc-server-ecs-security-group`
  });

  // EFS connection from ecs task
  efsSG.addIngressRule(
    Peer.securityGroupId(ecsSG.securityGroupId),
    Port.allTcp(),
    "allow ECS access",
  );

  ecsSG.addIngressRule(
    Peer.anyIpv4(),
    Port.tcp(25565),
    "IP range for TCP for mc"
  );

  ecsSG.addIngressRule(
    Peer.anyIpv4(),
    Port.udp(25565),
    "IP range for UDP for mc"
  );

  ecsSG.addIngressRule(
    Peer.anyIpv4(),
    Port.tcp(19132),
    "IP range for TCP for geyser"
  );

  ecsSG.addIngressRule(
    Peer.anyIpv4(),
    Port.udp(19132),
    "IP range for UDP for geyser"
  );

  const cluster = new Cluster(stack, "mc-server-cluster", {
    vpc,
    containerInsights: true,
    clusterName:`${deploymentType}-mc-server-cluster`,
    enableFargateCapacityProviders: true,
  });

  const service = new FargateService(stack, "mc-server-service", {
    serviceName:`${deploymentType}-mc-server-ecs-service`,
    cluster,
    taskDefinition,
    desiredCount: 1,
    securityGroups: [ecsSG],
    minHealthyPercent: 0,
    maxHealthyPercent: 100,
    assignPublicIp: true,
    enableExecuteCommand: true,
    capacityProviderStrategies: [
      {
        capacityProvider: 'FARGATE_SPOT',
        weight: 1,
      },
    ],
  });
}