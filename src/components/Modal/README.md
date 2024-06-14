```
<NextUIModal
    ...
    onClose={() => {
        ...
        disclosure.onClose() // -> Make sure to call this on every modal, otheriwse it'll cause "Maximum Depth Exceeded" error
    }}
    />
```
