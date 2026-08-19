---
title: "【力扣LeetCode热题h100】链表、二叉树"
slug: leetcode-hot100-linked-list-binary-tree
date: 2026-04-10 18:27:59
updated: 2026-04-10 18:28:12
categories:
  - "算法"
  - "LeetCode"
tags:
  - "LeetCode"
  - "链表"
  - "算法"
cover: /images/posts/backend-cover.webp
description: "本文总结了力扣LeetCode热题H100中关于链表和二叉树的常见算法题解。"
original_url: "https://blog.csdn.net/qq_41725967/article/details/159988298"
original_platform: CSDN
---

本文总结了力扣LeetCode热题H100中关于链表和二叉树的常见算法题解。

<!-- more -->

> 本文最初发布于 [CSDN](https://blog.csdn.net/qq_41725967/article/details/159988298)，现迁移至本站并做格式整理。内容保留原始观点与发布时间。

## 链表

### 22\. 相交链表

**题目：**  
给你两个单链表的头节点 headA 和 headB ，请你找出并返回两个单链表相交的起始节点。如果两个链表不存在相交节点，返回 null 。  
**代码：**

```c
class Solution {
public:
    ListNode *getIntersectionNode(ListNode *headA, ListNode *headB) {
        if(headA==nullptr || headB==nullptr)
            return nullptr;
        ListNode *pa=headA, *pb=headB;
        while(pa != pb){
            pa = pa==nullptr ? headB : pa->next;
            pb = pb==nullptr ? headA : pb->next; 
        }
        return pa;
    }
};
```

```java
public class Solution {
    public ListNode getIntersectionNode(ListNode headA, ListNode headB) {
        // 相交链表 “我 吹过你吹过的晚风~”
        // 那我们算不算相拥 算！
        ListNode A = headA, B = headB;
        while(A !=  B){
            A = A==null ? headB : A.next;
            B = B==null ? headA : B.next;
        }
        return A;
    }
}
```

**分析：**

-   假设有相交的点且相交之前各自的长度相同，每个人一次走一步同频的人自会相遇
-   假设有相交的点且相交之前各自的长度不同，两个人走完自己路再回过头来走一遍对方特有的路，虽然两人走的顺序是不同的，但是长度是相同的，相同即相交
-   假设没有相交，两人走完自己的再走对方的路，即使走到尽头也是一场`null`

**总结：**

-   简单做法哈希，记住是`insert`和`count`

* * *

### 23\. 反转链表

**题目：**  
给你单链表的头节点 head ，请你反转链表，并返回反转后的链表。  
**代码：**

```c
class Solution {
public:
    ListNode* reverseList(ListNode* head) {
        ListNode *curr=head, *pre=nullptr;
        while(curr != nullptr){
            ListNode *tmp=curr->next;
            curr->next = pre;
            pre = curr;
            curr = tmp;
        }
        return pre;
    }
};
```

```java
class Solution {
    public ListNode reverseList(ListNode head) {
        // 反转链表 敢写就能过
        ListNode cur = head;
        ListNode pre = null;
        while(cur != null){
            ListNode next = cur.next;
            cur.next = pre;
            pre = cur;
            cur = next;
        }
        return pre;
    }
}
```

**分析：**

-   因为不熟悉链表上来想到的是双指针然后`swap`
-   既然是链表肯定是断开修改指向性，这里不需要先走到最后，反正新链尾的最后一个元素指向`null`所以`pre`从`null`开始往前走就OK

**总结：**

-   链表的题一定要按链表的思维来做！

* * *

### 24\. 回文链表

**题目：**  
给你一个单链表的头节点 head ，请你判断该链表是否为回文链表。如果是，返回 true ；否则，返回 false 。  
**代码： 快慢指针找中点+反转后一半链表+双指针**

```c
class Solution {
    ListNode *middleNode(ListNode *head){
        ListNode *slow=head, *fast=head;
        while(fast && fast->next){
            slow = slow->next;
            fast = fast->next->next;
        }
        return slow;
    }
    
class Solution {
public:
    bool isPalindrome(ListNode* head) {
        ListNode *mid = middleNode(head);
        ListNode *h2 = reverseList(mid);
        while(h2){
            if(head->val != h2->val)
                return false;
            head = head->next;
            h2 = h2->next;
        }
        return true;
    }
};
```

```java
class Solution {
    public boolean isPalindrome(ListNode head) {
        // 回文链表 正常数组 双指针
        // 链表 找倒数 1 2 3 可以把后一半reverse一下
        ListNode mid = middleNode(head);
        ListNode head2 = reverseList(mid);
        while(head2!=null){
            if(head.val != head2.val){
                return false;
            }
            head = head.next;
            head2 = head2.next;

        }
        return true;
    }
 }
```

**分析：**

-   链表只能单向遍历，找回文的时候不能两边同时向中间走
-   回文具有对称性，后一半**反着读**和前一半是一样的；上一题不就是反着读吗，所以现在要解决找链表对称中点的问题
-   中点：简单方法遍历cnt++求链表长度；高级方法快慢指针，一个人一次走一步另一个人一次走两步，快的人走完了，慢的人走一半
-   长度的奇偶会影响前head链的长度，长度为奇数，两子链长度相同，长度为偶数head会长一个，这是因为head\[mid-1\]和head\[mid\]并没有断开，所以head\[mid\]在两条链中都会出现

**总结：**

-   链表的题一定要按链表的思维来做！

* * *

### 25\. 环形链表

**题目：**  
给你一个链表的头节点 head ，判断链表中是否有环。  
**代码： 快慢指针**

```c
class Solution {
public:
    bool hasCycle(ListNode *head) {
        ListNode *slow = head;
        ListNode *fast = head;
        while(fast && fast->next){
            slow = slow->next;
            fast = fast->next->next;
            if(slow == fast)
                return true;
        }
        return false;
    }
};
```

```java
public class Solution {
    public boolean hasCycle(ListNode head) {
        // 环形链表 快慢指针
        ListNode slow = head;
        ListNode fast = head;
        while(fast!=null && fast.next!=null){
            fast = fast.next.next;
            slow = slow.next;
            if(fast==slow){
                return true;
            }
        }
        return false;
    }
}
```

**总结：**

-   前年夏天，每天都会在操场上遇到一个也在跑步的女孩子，一开始我跑的甚至都没她快，两三个月过去，终于能套她圈了…
-   综上可得：跑得快的肯定能套跑的慢的圈，只是时间问题…

* * *

### 26\. 环形链表 II

**题目：**  
给定一个链表的头节点 head ，返回链表开始入环的第一个节点。 如果链表无环，则返回 null。  
**代码： 快慢指针**

```c
class Solution {
public:
    ListNode *detectCycle(ListNode *head) {
        ListNode *slow = head;
        ListNode *fast = head;
        while(fast && fast->next){
            slow = slow->next;
            fast = fast->next->next;
            if(fast == slow){
                while(slow != head){
                    slow = slow->next;
                    head = head->next;
                }
                return slow;
            }
        }
        return nullptr;
    }
};
```

**分析：**

-   假设进环前的路程为 a，环长为 b。
-   设慢指针走了 x 步时，快慢指针相遇，此时快指针走了 2x步。显然 2x-x=nb（快指针比慢指针多走了 n 圈），即 x=nb。也就是说慢指针总共走过的路程是 nb，但这 nb 当中，实际上包含了进环前的一个小 a，因此慢指针在环中只走了 nb-a 步，它还得再往前走 a 步，才是完整的 n 圈。
-   所以，我们让头节点和慢指针同时往前走，当他俩相遇时，就走过了最后这 a 步。

* * *

### 27\. 合并两个有序链表

**题目：**  
将两个升序链表合并为一个新的 升序 链表并返回。新链表是通过拼接给定的两个链表的所有节点组成的。  
**代码： 哨兵**

```c
class Solution {
public:
    ListNode* mergeTwoLists(ListNode* list1, ListNode* list2) {
        ListNode dummy{};
        auto curr =  &dummy;
        while(list1 && list2){
            if(list1->val < list2->val){
                curr->next = list1;
                list1 = list1->next;
            } else{
                curr->next = list2;
                list2 = list2->next;
            }
            curr = curr->next;
        }
        curr->next = list1 ? list1 : list2;
        return dummy.next;
    }
};
```

```java
class Solution {
    public ListNode mergeTwoLists(ListNode list1, ListNode list2) {
        // 合并两个有序链表 尾插
        if(list1==null) return list2;
        if(list2==null) return list1;
        ListNode dummy = new ListNode();
        ListNode cur = dummy;
        while(list1!=null && list2!=null){
            if(list1.val < list2.val){
                cur.next = list1;
                list1 = list1.next;
            } else{
                cur.next = list2;
                list2 = list2.next;
            }

            cur = cur.next;
        }
        cur.next = list1==null ? list2 : list1;
        return dummy.next;
    }
}
```

```java
class Solution {
    public ListNode mergeTwoLists(ListNode list1, ListNode list2) {
        // 合并两个有序链表 递归
        if(list1==null) return list2;
        if(list2==null) return list1;
        if(list1.val < list2.val){
            list1.next = mergeTwoLists(list1.next, list2);
            return list1;
        } else{
            list2.next = mergeTwoLists(list2.next, list1);
            return list2;
        }
    }
}
```

**分析：**

-   dummy是虚拟头节点，将后面需要添加的节点挂在dummy\[0\]后面，不用初始化head，直接返回dummy.next就ok

* * *

### 28\. 两数相加

**题目：**  
给你两个 非空 的链表，表示两个非负的整数。它们每位数字都是按照 逆序 的方式存储的，并且每个节点只能存储 一位 数字。  
请你将两个数相加，并以相同形式返回一个表示和的链表。  
**代码： 哨兵+模拟**

```c
class Solution {
public:
    ListNode* addTwoNumbers(ListNode* l1, ListNode* l2) {
        ListNode dummy;
        ListNode *curr = &dummy;
        int carry = 0;
        while(l1 || l2 || carry){
            if(l1){
                carry += l1->val;
                l1 = l1->next;
            }
            if(l2){
                carry += l2->val;
                l2 = l2->next;
            }
            curr = curr->next = new ListNode(carry%10);
            carry /= 10;
        }
        return dummy.next;
    }
};
```

```java
class Solution {
    public ListNode addTwoNumbers(ListNode l1, ListNode l2) {
        // 两数相加 处理好进位就ok 递归写法
        return addTwo(l1, l2, 0);
    }
    private ListNode addTwo(ListNode l1, ListNode l2, int carry){
        if(l1==null && l2==null && carry==0){
            return null;
        }
        int s = carry;
        if(l1!=null){
            s+= l1.val;
            l1 = l1.next;
        }
        if(l2!=null){
            s += l2.val;
            l2 = l2.next;
        }
        return new ListNode(s%10, addTwo(l1, l2, s/10));
    }
}
```

**分析：**

-   给定链表的数据是倒序的，这是为了方便我们低位向高位进位计算，要求返回的链表也是倒序的，上一题的哨兵记录头节点然后往后边走边存

* * *

### 29\. 删除链表的倒数第N个节点

**题目：**  
给你一个链表，删除链表的倒数第 n 个结点，并且返回链表的头结点。  
**代码： 哨兵+左右指针**

```c
class Solution {
public:
    ListNode* removeNthFromEnd(ListNode* head, int n) {
        ListNode dummy{0, head};
        ListNode *left = &dummy;
        ListNode *right = &dummy;
        while(n--)
            right = right->next;
        while(right->next){
        	//跳出时left指向被删除的前一个节点
            left = left->next;
            right = right->next;
        }
        ListNode *node = left->next;
        left->next = left->next->next;
        delete node;
        return dummy.next;
    }
};
```

```java
class Solution {
    public ListNode removeNthFromEnd(ListNode head, int n) {
        // 删除链表的倒数第n个节点 要求一次遍历
        // 双指针 定长滑动 右边到头了左边刚好到 倒数第二个 
        // 这里一定从dummy开始往后走！
        ListNode dummy = new ListNode(0, head);
        ListNode left = dummy;
        ListNode right = dummy;
        while(n-->0){
            right = right.next;
        }
        while(right.next != null){
            right = right.next;
            left = left.next;
        }
        left.next = left.next.next;
        return dummy.next;
    }
}
```

**分析：**

-   由于要定位倒数第n个节点， 先想到的是从尾结点向前数n个，但是cnt++并不高级
-   假设两指针本身就差n个位置，则同时向后遍历，右指针到头则左指针就定位到倒数第n个了
-   删除第n个需要的是倒数第n+1的节点，dummy{0, head}正好可以错开一个使得初值指向head前一个位置

* * *

### 30\. 两两交换链表中的节点

**题目：**  
给你一个链表，两两交换其中相邻的节点，并返回交换后链表的头节点。你必须在不修改节点内部的值的情况下完成本题（即，只能进行节点交换）。  
**代码： 哨兵**

```c
class Solution {
public:
    ListNode* swapPairs(ListNode* head) {
        ListNode dummy(0, head);
        ListNode *n1 = &dummy;
        ListNode *n2 = head;
        while(n2 && n2->next){
            ListNode *n3 = n2->next;
            ListNode *n4 = n3->next;
			// 头-[1-2]-3
			// n1 n2 n3 n4
            n1->next = n3;
            n3->next = n2;
            n2->next = n4;
			// n1 指向下一组的前一个节点， n2指向下一组的第一个节点
            n1 = n2;
            n2 = n4;
        }
        return dummy.next;

    }
};
```

```java
class Solution {
    public ListNode swapPairs(ListNode head) {
        // 两两交换链表中的节点 reverse的时候需要cur pre 临时next 这里需要两个临时的
        ListNode dummy = new ListNode(0, head);
        ListNode n1 = dummy;
        ListNode n2 = head;
        while(n2!=null && n2.next!=null){
            ListNode n3 = n2.next;
            ListNode n4 = n3.next;

            n1.next = n3;
            n3.next = n2;
            n2.next = n4;
            n1 = n2;
            n2 = n4;
        }
        return dummy.next;
    }
}
```

```java
public ListNode swapPairs(ListNode head) {
        // 两两交换链表中的节点 递归写法 先写边界 再讨论下一次递归
        if(head==null || head.next==null){
            return head;
        }
        ListNode n1 = head;
        ListNode n2 = n1.next;
        ListNode n3 = n2.next;

        n1.next = swapPairs(n3);
        n2.next = n1;
        return n2;
    }
```

**分析：**

-   只能节点交换，按照链表的思维定势，边移动边修改指针，结合哨兵便于返回头节点，便从0处开始往后遍历
-   n2,n3是要交换的两个节点，n1可以认为待交换两个节点的0处，n4可以认为是交换完成之后重新指向的尾部

* * *

### 31\. K 个一组翻转链表

**题目：**  
给你链表的头节点 head ，每 k 个节点一组进行翻转，请你返回修改后的链表。  
k 是一个正整数，它的值小于或等于链表的长度。如果节点总数不是 k 的整数倍，那么请将最后剩余的节点保持原有顺序。  
你不能只是单纯的改变节点内部的值，而是需要实际进行节点交换。  
**代码： 哨兵+部分翻转**

```c
class Solution {
public:
    ListNode* reverseKGroup(ListNode* head, int k) {
        int n=0;
        for(ListNode *p=head; p; p=p->next)
            n++;
    
        ListNode dummy(0, head);
        ListNode *pre = nullptr;
        ListNode *curr = head;
        ListNode *p0 = &dummy;
        while(n>=k){
            n -= k;
            for(int i=0; i<k; i++){
                ListNode *nxt = curr->next;
                // 当前节点向前指，前一段的指针向后移
                curr->next = pre;
                pre = curr;
                // curr处理下一节点，最终指向下一组的第一个
                curr = nxt;
            }
            ListNode *nxt = p0->next;
            // 将当前反转组和下一组的第一个链接
            p0->next->next = curr;
			// 将当前反转组和上一组链接
            p0->next = pre;
            // p0重定向
            p0 = nxt;
             
        }
        return dummy.next;
    }
};
```

```java
class Solution {
    public ListNode reverseKGroup(ListNode head, int k) {
        // k个一组反转链表 p0上一段最后一个 
        int n = 0;
        ListNode cur = head;
        while(cur!=null){
            cur = cur.next;
            n++;
        }
        ListNode dummy = new ListNode(0, head);
        ListNode p0 = dummy;
        cur = head;
        ListNode pre = null; // 临时变量 p0最终会替代pre
        while(n >= k){
            n-=k;
            for(int i=0; i<k; i++){
                ListNode next = cur.next;
                cur.next = pre;
                pre = cur;
                cur = next;
            }
            ListNode next = p0.next;
            p0.next.next = cur;
            p0.next = pre;
            p0 = next;
        }
        return dummy.next;
    }
}
```

**分析：**

-   翻转前，p0是当前反转段的前一个结点，pre指向空或者说上一段反转后的第一个结点，curr指向当前反转段的第一个节点
-   当前段反转后curr指向下一段的第一个节点，pre指向当前翻转段的反转后的最后一个节点
-   当前段翻转完毕后，再进行下一段时希望保持上述特征：
    -   保存当前翻转完了的尾结点：`ListNode *nxt = p0->next;`
    -   保证前后两组连接起来，上一组反转后的尾结点指向下一组的头：`p0->next->next = curr;`
    -   pre指向上一段反转后的尾结点： `p0->next = pre;`
    -   curr指向下一反转段的第一个节点，已经满足
    -   p0指向下一段前的一个节点，即反转完了的尾结点：`p0 = nxt;`

* * *

### 32\. 复制带随机指针的链表

**题目：**  
给你一个长度为 n 的链表，每个节点包含一个额外增加的随机指针 random ，该指针可以指向链表中的任何节点或空节点。  
**代码1： 新旧节点交替拼接**

```c
class Solution {
public:
    Node* copyRandomList(Node* head) {
        if(head == nullptr)
            return nullptr;
        // 新旧拼接
         for(Node *curr=head; curr; curr=curr->next->next)
            curr->next = new Node(curr->val, curr->next, nullptr);
         
         // 重定向新链表的random
         for(Node *curr=head; curr; curr=curr->next->next)
            if(curr->random)
                curr->next->random = curr->random->next;
         
         // 分离新旧链表，且还原旧链表
         Node *newhead = head->next;
         Node *curr = head;
         for(; curr->next->next; curr=curr->next){
            Node *p = curr->next;
            curr->next = curr->next->next; // 这一句完了curr->next就不是在原curr基础上的next了
            p->next = p->next->next;
         } // 新链表的尾节点始终指向空 只需要修改旧链表的尾节点
         curr->next = nullptr;
         return newhead;
    }
};
```

```java
class Solution { //java
    public Node copyRandomList(Node head) {
        // 随机链表的复制
        // 新旧 按次序交替拼接在一起 重定向random再拆分
        if(head == null) return null;
        Node cur = head;
        while(cur!=null){
            Node tmp = new Node(cur.val);
            tmp.next = cur.next;
            cur.next = tmp;
            cur = tmp.next;
        }
        // random重定向
        cur = head;
        while(cur!=null){
            if(cur.random != null){
                cur.next.random = cur.random.next;
            }
            cur = cur.next.next;
        }
        // 拆分
        cur = head.next;
        Node pre = head, ans = head.next;
        while(cur.next!=null){
            pre.next = pre.next.next;
            cur.next = cur.next.next;
            pre = pre.next;
            cur = cur.next;
        }
        pre.next = null;
        return ans;
    }
}
```

**分析：**

-   流程式做法，在不哈希存储的情况下便于`random`的定位：新旧节点交替链接，新节点的`random`等于对应旧节点`randon`的`next`

**代码2：哈希**

```c
class Solution {
public:
    Node* copyRandomList(Node* head) {
        if(!head)
            return nullptr;
        unordered_map<Node*, Node*> mp{{nullptr, nullptr}};
        Node *p = head;
        // 建立新旧映射
        while(p){ 
            Node *n=new Node(p->val);
            mp[p] = n;
            p = p->next;
        }
        // 修改新节点的next和random
        for(auto& [ori, copy] : mp){
            if(!ori) continue;
            copy->next = mp[ori->next];
            copy->random = mp[ori->random];
        }
        return mp[head];
    }
};
```

```java
class Solution { // java
    public Node copyRandomList(Node head) {
        // 随机链表的复制
        // 哈希表 建立新旧映射 再根据map组建链表
        if(head==null) return null;
        Node cur = head;
        Map<Node, Node> map = new HashMap<>();
        while(cur!=null){
            map.put(cur, new Node(cur.val));
            cur = cur.next;
        }
        // 重建链表
        cur = head;
        while(cur!=null){
            map.get(cur).next = map.get(cur.next);
            map.get(cur).random = map.get(cur.random);
            cur = cur.next;
        }
        return map.get(head);
    }
}
```

**分析：**

-   和上面一样也是建立新旧映射，新节点的`next`和`random`依赖于旧节点的信息
-   `mp{{nullptr, nullptr}};`是为了初始化建立空到空的映射，这样后面`mp[ori->next]`且`ori->next`为空的时候能直接返回空

* * *

### 33\. 排序链表

**题目：**  
给你链表的头结点 head ，请将其按**升序**排列并返回 排序后的链表 。  
**代码： 归并排序、分治**

```c
class Solution {
    ListNode *middleNode(ListNode *head){
        ListNode *slow=head;
        ListNode *fast=head;
        ListNode *pre=head;
        while(fast && fast->next){
            pre = slow;
            slow = slow->next;
            fast = fast->next->next;
        }
        pre->next = nullptr;
        return slow;
    }

     ListNode *mergeTwoLists(ListNode* list1, ListNode* list2){
        ListNode dummy;
        ListNode *cur=&dummy;
        while(list1 && list2){
            if(list1->val < list2->val){
                cur->next = list1;
                list1 = list1->next;
            }else{
                cur->next = list2;
                list2 = list2->next;
            }
            cur = cur->next;
        }
        cur->next = list1 ? list1 : list2;
        return dummy.next;
     }

public:
    ListNode* sortList(ListNode* head) {
        if(head==nullptr || head->next==nullptr)
            return head;
        // 归并
        ListNode *h2=middleNode(head);
        head = sortList(head);
        h2 = sortList(h2);

        return mergeTwoLists(head, h2);
    }
};
```

```java
class Solution { // java
    public ListNode sortList(ListNode head) {
        // 链表排序
        // 归并 分治，先找中点，再合并
        if(head==null || head.next==null) return head;
        ListNode fast = head.next, slow = head;
        while(fast!=null && fast.next!=null){
            fast = fast.next.next;
            slow = slow.next;
        }
        ListNode tmp = slow.next;
        slow.next = null;
        ListNode left = sortList(head);
        ListNode right = sortList(tmp);
        // 合并
        ListNode h = new ListNode(0);
        ListNode res = h;
        while(left!=null && right!=null){
            if(left.val < right.val){
                h.next = left;
                left = left.next;
            } else{
                h.next = right;
                right = right.next;
            }
            h = h.next;
        }
        h.next = left==null? right : left;
        return res.next;
    }
}
```

**分析：**

-   合并过程就是双指针依次取小，h 指针不断后移，始终指向已合并部分的最后一个节点，以便下次继续在后面追加。

* * *

### 34\. 合并K个升序链表

**题目：**  
给你一个链表数组，每个链表都已经按升序排列。  
请你将所有链表合并到一个升序链表中，返回合并后的链表。  
**代码1：最小堆**

```java
class Solution {
    public ListNode mergeKLists(ListNode[] lists) {
        // 合并K个升序链表
        // 最小堆/优先队列，全部的head入队，取最小，并将其next入队
        PriorityQueue<ListNode> pq = new PriorityQueue<>((a,b)->a.val - b.val);
        for(ListNode head : lists){
            if(head!=null){
                pq.offer(head);
            }
        }
        ListNode dummy = new ListNode();
        ListNode cur = dummy;
        while(!pq.isEmpty()){
            ListNode node = pq.poll();
            if(node.next!=null){
                pq.offer(node.next);
            }
            cur.next = node;
            cur = cur.next;
        }
        return dummy.next;
    }
}
```

**分析：**

-   因为已经是有序链表，我们每次从表头取最小元素假如新链表即可，一共有L个元素，m条子链，时间复杂度为 O ( L log ⁡ m ) O(L \\log m) O(Llogm)

**代码2：归并迭代、自底向上**

```java
class Solution {
    public ListNode mergeKLists(ListNode[] lists) {
        int m = lists.length;
        if(m==0){
            return null;
        }
        for(int step=1; step<m; step*=2){
            for(int i=0; i<m-step; i+=step*2){
                lists[i] = mergeTwoLists(lists[i], lists[i+step]);
            }
        }
        return lists[0];
    }
    // 21. 合并两个有序链表
    private ListNode mergeTwoLists(ListNode list1, ListNode list2) {
        ListNode dummy = new ListNode(); // 用哨兵节点简化代码逻辑
        ListNode cur = dummy; // cur 指向新链表的末尾
        while (list1 != null && list2 != null) {
            if (list1.val < list2.val) {
                cur.next = list1; // 把 list1 加到新链表中
                list1 = list1.next;
            } else { // 注：相等的情况加哪个节点都是可以的
                cur.next = list2; // 把 list2 加到新链表中
                list2 = list2.next;
            }
            cur = cur.next;
        }
        cur.next = list1 != null ? list1 : list2; // 拼接剩余链表
        return dummy.next;
    }
}
```

**分析：**

-   反复拆分左右边，有点归并的感觉？时间复杂度为 O ( L log ⁡ m ) O(L \\log m) O(Llogm)

* * *

### 35\. LRU缓存

**题目：**  
请你设计并实现一个满足 LRU (最近最少使用) 缓存 约束的数据结构。  
**代码：双向链表**

```java
class LRUCache {
    private static class Node {
        int key, value;
        Node prev, next;

        Node(int k, int v) {
            key = k;
            value = v;
        }
    }

    private final int capacity;
    private final Node dummy = new Node(0, 0); // 哨兵节点
    private final Map<Integer, Node> keyToNode = new HashMap<>();

    public LRUCache(int capacity) {
        this.capacity = capacity;
        dummy.prev = dummy;
        dummy.next = dummy;
    }

    public int get(int key) {
        Node node = getNode(key); // getNode 会把对应节点移到链表头部
        return node != null ? node.value : -1;
    }

    public void put(int key, int value) {
        Node node = getNode(key); // getNode 会把对应节点移到链表头部
        if (node != null) { // 有这本书
            node.value = value; // 更新 value
            return;
        }
        node = new Node(key, value); // 新书
        keyToNode.put(key, node);
        pushFront(node); // 放在最上面
        if (keyToNode.size() > capacity) { // 书太多了
            Node backNode = dummy.prev;
            keyToNode.remove(backNode.key);
            remove(backNode); // 去掉最后一本书
        }
    }

    // 获取 key 对应的节点，同时把该节点移到链表头部
    private Node getNode(int key) {
        if (!keyToNode.containsKey(key)) { // 没有这本书
            return null;
        }
        Node node = keyToNode.get(key); // 有这本书
        remove(node); // 把这本书抽出来
        pushFront(node); // 放在最上面
        return node;
    }

    // 删除一个节点（抽出一本书）
    private void remove(Node x) {
        x.prev.next = x.next;
        x.next.prev = x.prev;
    }

    // 在链表头添加一个节点（把一本书放在最上面）
    private void pushFront(Node x) {
        x.prev = dummy;
        x.next = dummy.next;
        x.prev.next = x;
        x.next.prev = x;
    }
}
```

**分析：**

-   就好像有一摞书，get的时候抽出这本书放在最上面，没有的时候返回-1
-   put的时候如果没有这本书直接放到最上面，有这本书的时候抽出放到最上面，然后修改value，
-   书的数目超出，则扔掉/删除最下面的书
-   找书的位置通过哈希表实现
-   抽出、删除、放最前面通过双向链表+哨兵实现

* * *

## 二叉树

### 36\. 二叉树的中序遍历

**题目：**  
给定一个二叉树的根节点 root ，返回 它的 中序 遍历 。  
**代码1：递归**

```java
class Solution {
    public List<Integer> inorderTraversal(TreeNode root) {
        List<Integer> ans = new ArrayList<>();
        dfs(ans, root);
        return ans;
    }

    private void dfs(List ans, TreeNode node){
        if(node == null){
            return;
        }
        dfs(ans, node.left);
        ans.add(node.val);
        dfs(ans, node.right);
    }
}
```

**分析：**

-   前中后序遍历，ans.add的位置不一样

### 37\. 二叉树的最大深度

**题目：**  
给定一个二叉树 root ，返回其最大深度。  
**代码：分治**

```java
class Solution {
    public int maxDepth(TreeNode root) {
        if(root==null) return 0;
        int lDepth = maxDepth(root.left);
        int rDepth = maxDepth(root.right);
        return Math.max(lDepth, rDepth)+1;
    }
}
```

**分析：**

-   一直往下问，问到树叶底端，然后从底下带着答案一层一层加 1 往上传递，直到回到根节点

* * *

### 38\. 翻转二叉树

**题目：**  
给你一棵二叉树的根节点 root ，翻转这棵二叉树，并返回其根节点。  
**代码：分治**

```java
class Solution {
    public TreeNode invertTree(TreeNode root) {
       if(root == null) return null;
       TreeNode left = invertTree(root.left);
       TreeNode right = invertTree(root.right);
       root.left = right;
       root.right = left;
       return root; 
    }
}
```

**分析：**

-   和上一题一样，也是递归下去。这里也可以先交换左右子树，再分别invert

* * *

### 39\. 对称二叉树

**题目：**  
给你一个二叉树的根节点 root ， 检查它是否轴对称。  
**代码：**

```java
class Solution {
    public boolean isSymmetric(TreeNode root) {
        return isSameTree(root.left, root.right);
    }

    private boolean isSameTree(TreeNode p, TreeNode q){
        if(p==null || q==null){
            return p == q;
        }
        return p.val==q.val && isSameTree(p.left, q.right) && isSameTree(p.right, q.left);
    }
}
```

**分析：**

-   值相等 且 左右对称

* * *

### 40\. 二叉树的直径

**题目：**  
给你一棵二叉树的根节点，返回该树的 直径 。  
**代码：**

```java
class Solution {
    private int ans;

    public int diameterOfBinaryTree(TreeNode root) {
        dfs(root);
        return ans;
    }

    private int dfs(TreeNode node){
        if(node==null){
            return -1;
        }
        int lLen = dfs(node.left)+1;
        int rLen = dfs(node.right)+1;
        ans = Math.max(ans, rLen+lLen);
        // 能向上提供多长的一条单向直线路径？
        return Math.max(rLen, lLen);
    }
}
```

**分析：**

-   依次遍历每个node的直径，向上汇报能提供最长的一条单向直线路径

* * *

### 41\. 二叉树的层序遍历

**题目：**  
给你二叉树的根节点 root ，返回其节点值的 层序遍历 。 （即逐层地，从左到右访问所有节点）。  
**代码1：两个数组**

```java
class Solution {
    public List<List<Integer>> levelOrder(TreeNode root) {
        if(root==null){
            return List.of();
        }
        List<List<Integer>> ans = new ArrayList<>();
        List<TreeNode> cur = List.of(root);
        while(!cur.isEmpty()){
            List<TreeNode> nxt = new ArrayList<>();
            List<Integer> vals = new ArrayList<>(cur.size());
            for(TreeNode node : cur){
                vals.add(node.val);
                if(node.left!=null) nxt.add(node.left);
                if(node.right!=null) nxt.add(node.right);
            }
            cur = nxt;
            ans.add(vals);
        }
        return ans;
    }
}
```

**代码2：1个队列**

```java
class Solution {
    public List<List<Integer>> levelOrder(TreeNode root) {
        if(root==null) return List.of();

        List<List<Integer>> ans = new ArrayList<>();
        Queue<TreeNode> q = new ArrayDeque<>();
        q.add(root);
        while(!q.isEmpty()){
            int n = q.size();
            List<Integer> vals = new ArrayList<>(n);
            while(n-- > 0){
                TreeNode node = q.poll();
                vals.add(node.val);
                if(node.left!=null) q.add(node.left);
                if(node.right!=null) q.add(node.right);
            }
            ans.add(vals);
        }
        return ans;
    }
}
```

**分析：**

-   两个数组：cur 就是一层，nxt就是下一层
-   1个队列：和本科学的一样了就

* * *

### 42\. 将有序数组转换为二叉搜索树

**题目：**  
给你一个整数数组 nums ，其中元素已经按 升序 排列，请你将其转换为一棵 平衡 二叉搜索树。  
**代码：**

```java
class Solution {
    public TreeNode sortedArrayToBST(int[] nums) {
        return dfs(nums, 0, nums.length);
    }

    private TreeNode dfs(int[] nums, int left, int right){
        if(left==right){
            return null;
        }
        int m = (left+right)>>>1;
        return new TreeNode(nums[m], dfs(nums, left, m), dfs(nums, m+1, right));
    }
}
```

**分析：**

-   分治、区间和位运算；left==right判断是否为叶子节点

* * *

### 43\. 验证二叉搜索树

**题目：**  
给你一个二叉树的根节点 root ，判断其是否是一个有效的二叉搜索树。  
**代码1：前序遍历**

```java
class Solution {
    public boolean isValidBST(TreeNode root) {
        return isValidBST(root, Long.MIN_VALUE, Long.MAX_VALUE);
    }

    private boolean isValidBST(TreeNode node, long left, long right){
        if(node==null) return true;
        long x = node.val;
        return left<x && right>x && isValidBST(node.left, left, x) && isValidBST(node.right, x, right);
    }
}
```

**代码2：中序遍历**

```java
class Solution {
    private long pre = Long.MIN_VALUE;

    public boolean isValidBST(TreeNode root) {
        if(root==null){
            return true;
        }
        if(!isValidBST(root.left)){
            return false;
        }
        if(root.val <= pre){
            return false;
        }
        pre = root.val;
        return isValidBST(root.right);
    }
}
```

**代码3：后序遍历**

```java
// 下次一腚
```

**分析：**

-   前序：递归检查规则
-   中序：检查是否是有序数组
-   后序：

* * *

### 44\. 二叉搜索树中第 K 小的元素

**题目：**  
给定一个二叉搜索树的根节点 root ，和一个整数 k ，请你设计一个算法查找其中第 k 小的元素（k 从 1 开始计数）。  
**代码：**

```java
class Solution {
    private int k;
    public int kthSmallest(TreeNode root, int k) {
        this.k = k;
        return dfs(root);
    }

    private int dfs(TreeNode node){
        if(node==null){
            return -1;
        }
        int leftAns = dfs(node.left);
        if(leftAns!=-1){
            return leftAns;
        }
        if(--k == 0){
            return node.val;
        }
        return dfs(node.right);
    }
}
```

**分析：**

-   中序遍历，用 -1 做状态信号，提早返回

* * *

### 45\. 二叉树的右视图

**题目：**  
给定一个二叉树的 根节点 root，想象自己站在它的右侧，按照从顶部到底部的顺序，返回从右侧所能看到的节点值。  
**代码1：DFS**

```java
class Solution {
    public List<Integer> rightSideView(TreeNode root) {
        List<Integer> ans = new ArrayList<>();
        dfs(root, 0, ans);
        return ans;
    }

    private void dfs(TreeNode node, int depth, List<Integer> ans){
        if(node==null){
            return;
        }
        if(depth == ans.size()){
            ans.add(node.val);
        }
        dfs(node.right, depth+1, ans);
        dfs(node.left, depth+1, ans);
    }
}
```

**代码2：BFS**

```java
class Solution {
    public List<Integer> rightSideView(TreeNode root) {
        if(root==null){
            return List.of();
        }
        List<Integer> ans = new ArrayList<>();
        List<TreeNode> cur = List.of(root);
        while(!cur.isEmpty()){
            List<TreeNode> nxt = new ArrayList<>();
            ans.add(cur.getLast().val);
            for(TreeNode node : cur){
                if(node.left!=null) nxt.add(node.left);
                if(node.right!=null) nxt.add(node.right);
            }
            cur = nxt;
        }
        return ans;
    }
}
```

**分析：**

-   DFS:中 -> 右 -> 左，到达某一个深度时，第一个碰到的节点，绝对就是站在右边能看到的那个节点
-   BFS：记录每行的最后一个

* * *

### 46\. 二叉树展开为链表

**题目：**  
给你二叉树的根结点 root ，请你将它展开为一个单链表：  
展开后的单链表应该同样使用 TreeNode ，其中 right 子指针指向链表中下一个结点，而左子指针始终为 null 。  
展开后的单链表应该与二叉树 先序遍历 顺序相同。  
**代码1：头插法**

```java
class Solution {
    private TreeNode head;
    public void flatten(TreeNode root) {
        if(root==null){
            return;
        }
        flatten(root.right);
        flatten(root.left);
        root.left = null;
        root.right = head;
        head = root;
    }
}
```

**代码2：分治**

```java
class Solution {
    public void flatten(TreeNode root) {
        dfs(root);
    }

    private TreeNode dfs(TreeNode root){
        if(root==null) return null;
        TreeNode leftTail = dfs(root.left);
        TreeNode rightTail = dfs(root.right);
        if(leftTail!=null){
            leftTail.right = root.right;
            root.right = root.left;
            root.left=null;
        }
        return rightTail!=null ? rightTail : leftTail!=null? leftTail : root;
    }
}
```

**分析：**

-   反着遍历“右左根”, 拿到节点断左手（left=null），右手牵着老车头（right=head）
-   向上返回链的最后一个，根据前序的位置进行拼接

* * *

### 47\. 从前序与中序遍历序列构造二叉树

**题目：**  
给定两个整数数组 preorder 和 inorder ，其中 preorder 是二叉树的先序遍历， inorder 是同一棵树的中序遍历，请构造二叉树并返回其根节点。  
**代码1：数组切分**

```java
class Solution {
    public TreeNode buildTree(int[] preorder, int[] inorder) {
        int n = preorder.length;
        if(n == 0) return null;
        int leftSize = indexOf(inorder, preorder[0]);
        int[] pre1 = Arrays.copyOfRange(preorder, 1, leftSize+1);
        int[] pre2 = Arrays.copyOfRange(preorder, 1+leftSize, n);
        int[] in1 = Arrays.copyOfRange(inorder, 0, leftSize);
        int[] in2 = Arrays.copyOfRange(inorder, leftSize+1, n);
        TreeNode left = buildTree(pre1, in1);
        TreeNode right = buildTree(pre2,in2);
        return new TreeNode(preorder[0], left, right); 
    }

    private int indexOf(int[] a, int x){
        for(int i=0; ; i++){
            if(a[i]==x){
                return i;
            }
        }
    }
}
```

**代码2：哈希优化**

```java
class Solution {
    public TreeNode buildTree(int[] preorder, int[] inorder) {
        int n = preorder.length;
        Map<Integer, Integer> index = new HashMap<>(n, 1);
        for(int i=0; i<n; i++){
            index.put(inorder[i], i);
        }
        return dfs(0, n, 0, preorder, index);
    }

    private TreeNode dfs(int preL, int preR,int inL, int[] preorder, Map<Integer,Integer> index){
        if(preL==preR){
            return null;
        }
        int leftSize = index.get(preorder[preL])-inL;
        TreeNode left = dfs(preL+1, preL+1+leftSize, inL, preorder, index);
        TreeNode right = dfs(preL+1+leftSize, preR, inL+1+leftSize, preorder, index);
        return new TreeNode(preorder[preL], left, right);
    }
}
```

**分析：**

-   数组存左右子树 -> 下标存

* * *

### 48\. 路径总和 III

**题目：**  
给定一个二叉树的根节点 root ，和一个整数 targetSum ，求该二叉树里节点值之和等于 targetSum 的 路径 的数目。

路径 不需要从根节点开始，也不需要在叶子节点结束，但是路径方向必须是向下的（只能从父节点到子节点）。  
**代码：**

```java
class Solution {
    private int ans;
    public int pathSum(TreeNode root, int targetSum) {
        // 类似前缀和 但是要恢复现场
        Map<Long,Integer> cnt = new HashMap<>();
        cnt.put(0L, 1);
        dfs(root, 0, targetSum, cnt);
        return ans;
    }

    private void dfs(TreeNode root, long s, int targetSum, Map<Long, Integer> cnt){
        if(root==null){
            return;
        }
        s += root.val;
        ans += cnt.getOrDefault(s-targetSum, 0);

        cnt.merge(s, 1, Integer::sum);
        dfs(root.left, s, targetSum, cnt);
        dfs(root.right, s, targetSum, cnt);
        cnt.merge(s, -1, Integer::sum);
    }
}
```

**分析：**

-   前缀和 + 当前节点退出之前要恢复现场

* * *

### 49\. 二叉树的最近公共祖先

**题目：**  
给定一个二叉树, 找到该树中两个指定节点的最近公共祖先。  
**代码：**

```java
class Solution {
    public TreeNode lowestCommonAncestor(TreeNode root, TreeNode p, TreeNode q) {
        if(root==null || root==p || root==q){
            return root;
        }
        TreeNode left = lowestCommonAncestor(root.left, p, q);
        TreeNode right = lowestCommonAncestor(root.right, p, q);
        if(left!=null && right!=null){
            return root;
        }
        return left!=null ? left : right;
    }
}
```

**分析：**

-   `if(left!=null && right!=null)`都找到了则是最近的

* * *

### 50\. 二叉树中的最大路径和

**题目：**  
二叉树中的 路径 被定义为一条节点序列，序列中每对相邻节点之间都存在一条边。同一个节点在一条路径序列中 至多出现一次 。该路径 至少包含一个 节点，且不一定经过根节点。

路径和 是路径中各节点值的总和。

给你一个二叉树的根节点 root ，返回其 最大路径和 。  
**代码：**

```java
class Solution {
    private int ans = Integer.MIN_VALUE;
    public int maxPathSum(TreeNode root) {
        dfs(root);
        return ans;
    }

    private int dfs(TreeNode node){
        if(node==null) return 0;
        int lVal = dfs(node.left);
        int rVal = dfs(node.right);
        ans = Math.max(ans, lVal+rVal+node.val);
        return Math.max(Math.max(lVal, rVal) + node.val, 0);
    }
}
```

**分析：**

-   递归，感觉需要先考虑返回值，在每个node退出时需要向上抛什么，然后上面递归的时候就就接住什么，再根据接住的东西做一些简单处理

* * *
