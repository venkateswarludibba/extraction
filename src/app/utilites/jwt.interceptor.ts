import { HttpInterceptorFn } from "@angular/common/http";

export const JwtInterceptor :HttpInterceptorFn = (req,next) => {
    const token = "";
    if(token)
    {
        req.clone({
            setHeaders:{
                Authorization:`Bearer ${token}`
            }
        })
    }

   return next(req);
}