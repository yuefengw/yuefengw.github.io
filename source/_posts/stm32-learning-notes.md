---
title: "铁头山羊stm32学习笔记"
slug: stm32-learning-notes
date: 2025-05-30 17:36:10
updated: 2025-05-30 17:36:56
categories:
  - "嵌入式"
  - "STM32"
tags:
  - "STM32"
  - "学习"
  - "笔记"
cover: /images/csdn/stm32-learning-notes/01.webp
description: "本文主要记录了计算机研一学生自学STM32的学习笔记，重点总结了GPIO和串口通信的基本原理。在GPIO部分，详细介绍了四种输出模式（推挽、开漏、通用、复用）的工作原理及特点，以及输入模式中的上/下拉电阻作用。在串口通信部分，解析了UART协议的数据帧结构、校验机制及全双工/半双工模式区别，并举例说明了波特率计算方法。文中还包含LED闪灯实验等实践内容，…"
original_url: "https://blog.csdn.net/qq_41725967/article/details/147065845"
original_platform: CSDN
---

本文主要记录了计算机研一学生自学STM32的学习笔记，重点总结了GPIO和串口通信的基本原理。在GPIO部分，详细介绍了四种输出模式（推挽、开漏、通用、复用）的工作原理及特点，以及输入模式中的上/下拉电阻作用。在串口通信部分，解析了UART协议的数据帧结构、校验机制及全双工/半双工模式区别，并举例说明了波特率计算方法。文中还包含LED闪灯实验等实践内容，…

<!-- more -->

> 本文最初发布于 [CSDN](https://blog.csdn.net/qq_41725967/article/details/147065845)，现迁移至本站并做格式整理。内容保留原始观点与发布时间。

### background

计算机研一自学stm32  
时间：2425/04/08——  
在线激情偷学~

### STM32基本信息

![文章配图](/images/csdn/stm32-learning-notes/01.webp)  
![文章配图](/images/csdn/stm32-learning-notes/02.webp)

-   Vcc Vdd都表示+，Vss GND都表示-
-   漏极始终打开叫做开漏  
    ![文章配图](/images/csdn/stm32-learning-notes/03.webp)
-   BOOT0：上面那个跳帽，在左面的时候就是接低电平，右边就是接高电平
-   引脚编号规则：小圆点开始，逆时针引脚编号从1递增

### GPIO

#### GPIO的四种输出模式

![文章配图](/images/csdn/stm32-learning-notes/04.webp)

-   推挽：push-pull，向外推电流，向内拉电流，
-   给0时，下面的MOS闭合，IO口呈低电平，给1上面的MOS闭合，呈高电平，交替导通，不可同时闭合  
    ![-](/images/csdn/stm32-learning-notes/05.webp)
-   开漏：上面的P-MOS管漏极一直断开，对于下面的MOS管来说相当于开漏
-   给0时，下面的MOS闭合，IO口呈低电平，给1时，下面的MOS打开，IO口此时为悬空状态，展现为高阻抗  
    ![文章配图](/images/csdn/stm32-learning-notes/06.webp)
-   通用：CPU直接控制IO引脚的输出
-   复用：CPU间接控制IO引脚输出，这里的片上外设指GOIP，TIM，SPI，I2C…

#### IO的最大输出速度

![文章配图](/images/csdn/stm32-learning-notes/07.webp)

-   IO最大输出速度:向IO交替写0和1且输出不失真的最快速度
-   上升时间和下降时间限制了IO的最大输出速度，上升时间和下降时间越短，IO的最大输出速度越大
-   EMI问题：指的是电子设备之间或电子设备与外部环境之间相互产生的电磁干扰现象。
-   人眼的临界闪烁频率是45.8Hz
-   单片机可选2MHz、10MHz、50MHz

#### LED闪灯实验

![文章配图](/images/csdn/stm32-learning-notes/08.webp)

-   开漏接法下点亮LED：上面的P-MOS始终断开，给0接Vss线路导通，给1相当于高阻态不导通

#### GPIO的四种输入模式

![文章配图](/images/csdn/stm32-learning-notes/09.webp)

-   当IO引脚浮空什么都不接的时候，接收到的数据和空间电磁波有关系，所以两个电阻起到稳定电路的作用
-   上拉电阻为电路提供稳定的高电压
-   下拉电阻为电路提供稳定的低电压
-   模拟模式和ADC、DAC有关

### 串口

![文章配图](/images/csdn/stm32-learning-notes/10.webp)

#### 通信协议

![文章配图](/images/csdn/stm32-learning-notes/11.webp)

-   空闲时Tx为高电压，拉低到起始位表示将要开始发送数据
-   按字节(数据帧)发送数据，每个字节(数据帧)发送后Tx置高，若停止发送，则Tx始终为高；若要继续发送下一字节(数据帧)则再将Tx拉低到起始位
-   每个字节**先发低位后发高位**
-   可一发多收  
    ![文章配图](/images/csdn/stm32-learning-notes/12.webp)
-   通常使用8位无校验和9位带校验两种数据帧
-   奇校验：发送方数据帧中需要有奇数个1，校验位根据数据位中1的个数来确定是0还是1，接收方根据接收帧的数据来判断发送过程中数据是否正确  
    ![文章配图](/images/csdn/stm32-learning-notes/13.webp)

#### UART

![文章配图](/images/csdn/stm32-learning-notes/14.webp)

-   分频器：根据BRR里面的数据进行分频，如2分频等
    
-   如：`115200=72MHz/39.0625/16`， 将39.0625写入BBR即可
    
-   **外设**的输入输出使用的都是哪些个引脚：查引脚分布表的**复用**功能默认，如USART1\_TX使用的是PA9，使能重映射后使用的就是PB6
    
-   TxE:指示发送数据寄存器里有无数据，当发送数据寄存器为空的时候TxE=1
    
-   TC：指示是否发送完成，当发送数据寄存器和移位寄存器都为空的时候TC=1  
    ![文章配图](/images/csdn/stm32-learning-notes/15.webp)
    
-   全双工：发送的时候也能接收
    
-   半双工：同一时刻只能单向发送数据
