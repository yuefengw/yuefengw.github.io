---
title: "Day3：【LeetCode-三周攻克数据结构 】题目分析笔记（C语言）"
slug: leetcode-data-structure-day-3
date: 2022-01-11 18:15:39
updated: 2022-01-11 18:15:39
categories:
  - "算法"
  - "LeetCode"
tags:
  - "数据结构"
  - "LeetCode"
  - "C"
cover: /images/posts/backend-cover.webp
description: "本文介绍了解决两个数组交集及买卖股票最大利润问题的方法。首先通过排序和双指针技术找到两个数组的交集，接着使用在线处理算法计算股票最大利润。"
original_url: "https://blog.csdn.net/qq_41725967/article/details/122438572"
original_platform: CSDN
---

本文介绍了解决两个数组交集及买卖股票最大利润问题的方法。首先通过排序和双指针技术找到两个数组的交集，接着使用在线处理算法计算股票最大利润。

<!-- more -->

> 本文最初发布于 [CSDN](https://blog.csdn.net/qq_41725967/article/details/122438572)，现迁移至本站并做格式整理。内容保留原始观点与发布时间。

## 一、两个数组的交集 II

### 1、题目：

**给你两个整数数组 nums1 和 nums2 ，请你以数组形式返回两数组的交集。返回结果中每个元素出现的次数，应与元素在两个数组中都出现的次数一致（如果出现次数不一致，则考虑取较小值）。可以不考虑输出结果的顺序。**

### 2、代码如下：

```c
int cmp(const void *_a,const void *_b){
    int a = *(int*)_a, b = *(int*)_b;
    return a - b;
}

int min_ab(int a, int b){
    int c = (a < b) ? a : b;
    return c;
}

int* intersect(int* nums1, int nums1Size, int* nums2, int nums2Size, int* returnSize){
    qsort(nums1,nums1Size,sizeof(int),cmp);
    qsort(nums2,nums2Size,sizeof(int),cmp);
    int *ans = (int*)malloc(sizeof(int) * min_ab(nums1Size,nums2Size));
    int i,j,k;
    i = 0; j = 0; k = 0;
    while(i<nums1Size && j<nums2Size){
        if(nums1[i] == nums2[j]){
            ans[k] = nums1[i];
            k++, i++, j++;
        }
        else if(nums1[i] < nums2[j])
        i++;
        else
        j++;
    }
    *returnSize = k;
    return ans;
}
```

### 3、解题思路：

我第一次看这个题的时候不太理解是什么意思，其实就是通过一个数组返回两数组的交集，如果一个元素a在两个数组中都出现了n次，则返回的数组中a应该出现n次，如果a在两个数组中出现的次数不同，则返回数组中a出现的次数应该等于出现少的次数。  
因为可以不考虑输出结果的次序，就先将两个数组递增排序，然后利用双指针，当指向元素相同时放入返回数组`ans`中，若指向元素不相等则小的指针指向下一个元素重复上述操作，直到其中一个指针指向数组尾部。

### 4、关键语句分析：

##### 1、

```c
int cmp(const void *_a,const void *_b){
    int a = *(int*)_a, b = *(int*)_b;
    return a - b;
}

    qsort(nums1,nums1Size,sizeof(int),cmp);
    qsort(nums2,nums2Size,sizeof(int),cmp);
```

[实现快排功能，前边已经讲过，点这里移步。](https://blog.csdn.net/qq_41725967/article/details/122379281)

##### 2、

```c
int *ans = (int*)malloc(sizeof(int) * min_ab(nums1Size,nums2Size));
```

`malloc`是开辟空间用的，因为函数体内定义的东西运行结束会自动清理，所以需要给返回的数组开辟一段空间  
`ans`为返回数组的首地址  
在这里只需要分配最小数组大小的空间就行了

##### 3、

```c
    while(i<nums1Size && j<nums2Size){
        if(nums1[i] == nums2[j]){
            ans[k] = nums1[i];
            k++, i++, j++;
        }
        else if(nums1[i] < nums2[j])
        i++;
        else
        j++;
    }
```

循环条件：当其中一个指针指向其尾部时  
相等时全部指针++  
否则的话小的指针++

## 二、买卖股票的最佳时机

### 1、题目：

**给定一个数组 prices ，它的第 i 个元素 prices\[i\] 表示一支给定股票第 i 天的价格。你只能选择 某一天 买入这只股票，并选择在 未来的某一个不同的日子 卖出该股票。设计一个算法来计算你所能获取的最大利润。返回你可以从这笔交易中获取的最大利润。如果你不能获取任何利润，返回 0 。**

### 2、代码如下：

```c
int maxProfit(int* prices, int pricesSize){
    int this_sum, max_sum;
    max_sum = 0;
    this_sum = 0;
    for(int i=1; i<pricesSize; i++){
        this_sum += prices[i] - prices[i-1];
        if(this_sum > max_sum)
        max_sum = this_sum;
        else if(this_sum <= max_sum && this_sum >= 0)
        ;
        else
        this_sum = 0;
    }
    return max_sum;
}
```

### 3、解题思路：

类似于，[求最大子数组和（点这里查看）](https://blog.csdn.net/qq_41725967/article/details/122379281)，在力扣上看到了更好的解法，[点这里移步](https://leetcode-cn.com/problems/best-time-to-buy-and-sell-stock/solution/leetcode121122mai-mai-gu-piao-de-zui-jia-a3sb/)，运用了在线处理算法，大家去看他的吧，我描述的不如他好。

### 4、关键语句分析：

##### 1、

```c
for(int i=1; i<pricesSize; i++){
        this_sum += prices[i] - prices[i-1];
        if(this_sum > max_sum)
        max_sum = this_sum;
        else if(this_sum <= max_sum && this_sum >= 0)
        ;
        else
        this_sum = 0;
    }
```

`this_sum`用于存放当前看起来能赚钱的钱，当`this_sum` > `max_sum`时更新`max_sum`的值，当`this_sum` < 0时，说明之前的这段求和的期间没赚到钱，于是直接置零，从后边的序列中重新累计。
