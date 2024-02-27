import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as ec2 from 'aws-cdk-lib/aws-ec2';

export class FckNatCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'test-vpc', {
      maxAzs: 1,
      ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/16"),
      subnetConfiguration: [
        {
          name: 'test-vpc-public',
          cidrMask: 24,
          subnetType: ec2.SubnetType.PUBLIC
        },
        {
          name: 'test-vpc-private',
          cidrMask: 24,
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
        },
      ],
      natGateways: 0, //NAT Gatewayを作らない
    });

    // test向けSG
    const testSG = new ec2.SecurityGroup(this, 'testSG', {
      vpc: vpc,
    });
    
    // natはtestからの接続をすべて許可
    const natSG = new ec2.SecurityGroup(this, 'natSG', {
      vpc: vpc,
    });
    natSG.addIngressRule(
      ec2.Peer.securityGroupId(testSG.securityGroupId),
      ec2.Port.allTcp(),
      "allow all access from test instance"
    );

    const natInstance = new ec2.Instance(this, 'nat-instance', {
      vpc: vpc,
      vpcSubnets: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PUBLIC
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
      machineImage: ec2.MachineImage.genericLinux({
        "ap-northeast-1": "ami-0bd55daf0b51c6b71"   // fck-nat(ARM64)のAMI
      }),
      associatePublicIpAddress: true,
      sourceDestCheck: false,   // 送信先チェックはしない
      ssmSessionPermissions: true,
      securityGroup: natSG,
    });

    // テスト用インスタンス
    const test = new ec2.Instance(this, 'test-instance', {
      vpc: vpc,
      vpcSubnets: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      ssmSessionPermissions: true,  // Session Managerで接続できるように
      securityGroup: testSG,
    });

    // testインスタンスにSession Managerで接続できるように必要なEndpointを作成
    const endpointSG = new ec2.SecurityGroup(this, 'endpoint-sg', {
      vpc: vpc,
    });

    new ec2.InterfaceVpcEndpoint(this, 'ssm-messages-endpoint', {
      vpc: vpc,
      subnets: vpc.selectSubnets({subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS}),
      service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
      securityGroups: [endpointSG],
      privateDnsEnabled: true,
    });

    new ec2.InterfaceVpcEndpoint(this, 'ssm-endpoint', {
      vpc: vpc,
      subnets: vpc.selectSubnets({subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS}),
      service: ec2.InterfaceVpcEndpointAwsService.SSM,
      securityGroups: [endpointSG],
      privateDnsEnabled: true,
    });

    new ec2.InterfaceVpcEndpoint(this, 'ec2-messages-endpoint', {
      vpc: vpc,
      subnets: vpc.selectSubnets({subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS}),
      service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
      securityGroups: [endpointSG],
      privateDnsEnabled: true,
    });

    // private subnetがNATインスタンス経由で外部にアクセスできるよう、RouteTableを編集
    const rtb = new ec2.CfnRouteTable(this, 'rtb', {
      vpcId: vpc.vpcId
    });

    new ec2.CfnRoute(this, 'test-route', {
      instanceId: natInstance.instanceId,
      destinationCidrBlock: '0.0.0.0/0',
      routeTableId: rtb.ref,
    });

    vpc.privateSubnets.forEach((s, i)  => 
      new ec2.CfnSubnetRouteTableAssociation(this, `subnet-association-${i}`, {
        routeTableId: rtb.ref,
        subnetId: s.subnetId,
      })
    );

  }
}
