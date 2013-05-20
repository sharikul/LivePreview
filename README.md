# LivePreview
LivePreview is a front end playground for HTML and CSS. It aims to be really simple with simple features. Play around with it on <a href="http://livepreview.webege.com">livepreview.webege.com</a>. Help make LivePreview better by contributing to this repo. 

<center>
<img src="https://raw.github.com/sharikul/LivePreview/master/imgs/icon.png" alt="LivePreview logo">
</center>

## Update to CSS engine - 20/05/2013 (UK Timestamp)
LivePreview's CSS processor now allows you to reference values using variables, starting with the `$` symbol. Here's how you may go about using it:  

<pre>$lg = lightgray;
@import url(url-to-css-file-here-this-is-optional)

body {
    background: $lg; 
    /* This will change to background: lightgray;*/
}</pre>

It will be processed in real time and your changes will be visible on the fly. **Please remember to define your variables at the very top of the CSS box before adding any import statements or else the engine will fail to process the variables. Also remember to use the equals notation, not colon!**.
